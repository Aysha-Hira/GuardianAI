from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

from experiments.multicam.camera_tracker import CameraRunResult, TrackState
from experiments.multicam.global_assign import apply_global_ids_to_annotations
from experiments.multicam.global_identity import GlobalIdentity, GlobalIdentityManager, LocalTrackRef
from experiments.multicam.track_embedding import build_track_embedding
from experiments.reid.osnet_extractor import OSNetExtractor

MIN_OVERLAP_SECONDS = 0.4
ADAPTIVE_MARGIN = 0.05
ADAPTIVE_CAP = 0.85
WEAK_MAX_SCORE = 0.10
WEAK_JOIN_SLACK = 0.08
WITHIN_Z = 0.0
CROSS_Z = 0.0
WEAK_Z_SLACK = 0.4
SURE_MATCH = 0.85
MIN_PAIRS_FOR_Z = 3
ABS_CROSS_FLOOR = 0.40
CAMERA_COLOR_NORMALISE = os.getenv("MULTICAM_COLOR_NORMALISE", "0") not in {"0", "false", "off"}


def _lab_stats(crops: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    px = np.concatenate([cv2.cvtColor(c, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32) for c in crops])
    return px.mean(axis=0), px.std(axis=0) + 1e-3


def _normalise_cameras(results: list[CameraRunResult]) -> dict[str, tuple[np.ndarray, np.ndarray]] | None:
    per_cam: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    all_crops: list[np.ndarray] = []
    for res in results:
        crops = [c for st in res.tracks.values() for c, _ in st.crop_samples[:6] if c.size]
        if crops:
            per_cam[res.camera_id] = _lab_stats(crops)
            all_crops.extend(crops)
    if len(per_cam) < 2:
        return None
    target = _lab_stats(all_crops)
    return {cam: (mu, sd, target[0], target[1]) for cam, (mu, sd) in per_cam.items()}


def _camera_zscores(sim: np.ndarray, cams: np.ndarray, threshold: float) -> np.ndarray:
    z = (sim - threshold) / 0.1
    for a in np.unique(cams):
        for b in np.unique(cams):
            mask = np.outer(cams == a, cams == b)
            if a == b:
                mask &= ~np.eye(len(sim), dtype=bool)
            vals = sim[mask]
            if vals.size >= MIN_PAIRS_FOR_Z * (2 if a == b else 1) and vals.std() > 1e-4:
                z[mask] = (sim[mask] - vals.mean()) / vals.std()
    return z


def _best_assignment(M: np.ndarray, floor: float) -> list[tuple[int, int]]:
    import itertools

    n_a, n_b = M.shape
    if n_a == 0 or n_b == 0:
        return []
    if max(n_a, n_b) > 8:
        out, ua, ub = [], set(), set()
        for v, i, j in sorted(((M[i, j], i, j) for i in range(n_a) for j in range(n_b)), reverse=True):
            if v >= floor and i not in ua and j not in ub:
                out.append((i, j)); ua.add(i); ub.add(j)
        return out
    best, best_pairs = float("-inf"), []
    if n_a <= n_b:
        for perm in itertools.permutations(range(n_b), n_a):
            pairs = [(i, perm[i]) for i in range(n_a) if M[i, perm[i]] >= floor]
            tot = sum(M[i, j] for i, j in pairs)
            if tot > best:
                best, best_pairs = tot, pairs
    else:
        for perm in itertools.permutations(range(n_a), n_b):
            pairs = [(perm[j], j) for j in range(n_b) if M[perm[j], j] >= floor]
            tot = sum(M[i, j] for i, j in pairs)
            if tot > best:
                best, best_pairs = tot, pairs
    return best_pairs


def _apply_norm(crop: np.ndarray, norm) -> np.ndarray:
    mu, sd, tmu, tsd = norm
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab = (lab - mu) / sd * tsd + tmu
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


@dataclass
class _Item:
    camera_id: str
    state: TrackState
    embedding: np.ndarray
    weight: float
    weak: bool = False


def _overlap(a: TrackState, b: TrackState) -> float:
    return min(a.last_time, b.last_time) - max(a.start_time, b.start_time)


def assign_global_identities(
    results: list[CameraRunResult],
    manager: GlobalIdentityManager,
    reid: OSNetExtractor,
    *,
    threshold: float,
    max_crops: int = 10,
) -> dict:
    all_norms = _normalise_cameras(results)
    norms = all_norms if CAMERA_COLOR_NORMALISE else None
    alt_embeddings: list[np.ndarray] = []
    items: list[_Item] = []
    for res in results:
        norm = norms.get(res.camera_id) if norms else None
        alt_norm = all_norms.get(res.camera_id) if (all_norms and norms is None) else None
        for state in sorted(res.tracks.values(), key=lambda s: s.start_time):
            if not state.crop_samples:
                continue
            samples = state.crop_samples
            if norm is not None:
                samples = [(_apply_norm(c, norm), sc) for c, sc in state.crop_samples]
            try:
                emb = build_track_embedding(reid, samples, min_crops=1, max_crops=max_crops)
            except ValueError:
                continue
            if alt_norm is not None:
                alt = [(_apply_norm(c, alt_norm), sc) for c, sc in state.crop_samples]
                alt_embeddings.append(build_track_embedding(reid, alt, min_crops=1, max_crops=max_crops))
            else:
                alt_embeddings.append(emb)
            top = sorted((s for _, s in state.crop_samples), reverse=True)[:max_crops]
            items.append(
                _Item(res.camera_id, state, emb, max(0.05, float(np.mean(top))), weak=top[0] < WEAK_MAX_SCORE)
            )

    n = len(items)
    if n == 0:
        return {"threshold_used": threshold, "tracks": 0, "identities": 0}

    emb = np.stack([it.embedding for it in items])
    sim = emb @ emb.T
    cannot = np.zeros((n, n), dtype=bool)
    for i in range(n):
        for j in range(i + 1, n):
            if items[i].camera_id == items[j].camera_id and _overlap(items[i].state, items[j].state) > MIN_OVERLAP_SECONDS:
                cannot[i, j] = cannot[j, i] = True

    strong_mask = np.array([not it.weak for it in items])
    neg_mask = np.triu(cannot, 1) & strong_mask[:, None] & strong_mask[None, :]
    negatives = sim[neg_mask]

    cams = np.array([it.camera_id for it in items])
    camera_aware = bool(cannot.any())
    if camera_aware:
        Z = _camera_zscores(sim, cams, threshold)
        within_bar, cross_bar, weak_bar = WITHIN_Z, CROSS_Z, WITHIN_Z - WEAK_Z_SLACK
    else:
        Z = sim
        within_bar, cross_bar, weak_bar = float(threshold), ABS_CROSS_FLOOR, float(threshold) - WEAK_JOIN_SLACK
    w = np.array([it.weight for it in items])

    def link(a: list[int], b: list[int]) -> float:
        ww = np.outer(w[a], w[b])
        return float((Z[np.ix_(a, b)] * ww).sum() / ww.sum())

    def compatible(a: list[int], b: list[int]) -> bool:
        return not cannot[np.ix_(a, b)].any()

    per_camera: list[list[list[int]]] = []
    unassigned = 0
    weak_count = 0
    for res in results:
        mem = [i for i in range(n) if items[i].camera_id == res.camera_id]
        strong = [i for i in mem if not items[i].weak] or mem
        weak = [i for i in mem if i not in strong]
        weak_count += len(weak)
        groups: list[list[int]] = [[i] for i in strong]
        while True:
            best, pair = within_bar, None
            for x in range(len(groups)):
                for y in range(x + 1, len(groups)):
                    if not compatible(groups[x], groups[y]):
                        continue
                    sx = link(groups[x], groups[y])
                    raw = float(sim[np.ix_(groups[x], groups[y])].mean())
                    score = sx if raw < SURE_MATCH else max(sx, within_bar + 1.0)
                    if score >= best:
                        best, pair = score, (x, y)
            if pair is None:
                break
            x, y = pair
            groups[x] = groups[x] + groups[y]
            del groups[y]
        for i in sorted(weak, key=lambda k: -items[k].weight):
            options = [(float(Z[i, g].mean()), g) for g in groups if compatible([i], g)]
            options = [o for o in options if o[0] >= weak_bar]
            if options:
                max(options, key=lambda o: o[0])[1].append(i)
            else:
                unassigned += 1
                items[i].state.global_id = None
        per_camera.append(groups)

    clusters: list[list[int]] = per_camera[0] if per_camera else []
    for groups in per_camera[1:]:
        M = np.array([[link(a, b) for b in groups] for a in clusters]) if clusters and groups else np.zeros((0, 0))
        pairs = _best_assignment(M, cross_bar) if M.size else []
        used_a = {i for i, _ in pairs}
        used_b = {j for _, j in pairs}
        merged = [clusters[i] + groups[j] for i, j in pairs]
        merged += [c for k, c in enumerate(clusters) if k not in used_a]
        merged += [g for k, g in enumerate(groups) if k not in used_b]
        clusters = merged
    used = float(threshold)
    adaptive = None

    cam_order = {res.camera_id: k for k, res in enumerate(results)}
    clusters.sort(key=lambda c: min((cam_order[items[i].camera_id], items[i].state.start_time) for i in c))

    for gid, members in enumerate(clusters, start=1):
        members.sort(key=lambda i: (cam_order[items[i].camera_id], items[i].state.start_time))
        rep = (emb[members] * w[members, None]).sum(axis=0)
        rep = (rep / max(np.linalg.norm(rep), 1e-9)).astype(np.float32)
        last = items[members[-1]]
        ident = GlobalIdentity(
            global_id=gid,
            representative_embedding=rep,
            last_seen_camera=last.camera_id,
            last_seen_time=last.state.last_time,
            appearance_samples=sum(len(items[i].state.crop_samples) for i in members),
            recent_local_tracks=[
                LocalTrackRef(items[i].camera_id, items[i].state.local_track_id, items[i].state.start_time, items[i].state.last_time)
                for i in members
            ],
        )
        manager._identities[gid] = ident
        for i in members:
            it = items[i]
            manager._assignments[(it.camera_id, it.state.local_track_id)] = gid
            it.state.global_id = gid
            it.state.embedding = it.embedding
            it.state.eligible = True
            it.state.assigned = True

        for a, b in zip(members, members[1:]):
            ia, ib = items[a], items[b]
            if ia.camera_id == ib.camera_id:
                continue
            manager._transitions.append(
                {
                    "global_id": gid,
                    "from_camera": ia.camera_id,
                    "from_local_track": ia.state.local_track_id,
                    "to_camera": ib.camera_id,
                    "to_local_track": ib.state.local_track_id,
                    "similarity": round(float(sim[a, b]), 4),
                    "time_gap_seconds": round(max(0.0, ib.state.start_time - ia.state.last_time), 2),
                }
            )
    manager._next_id = len(clusters) + 1

    for res in results:
        apply_global_ids_to_annotations(res.tracks, res.annotations_by_frame)

    info = {
        "threshold_requested": round(float(threshold), 3),
        "threshold_used": round(used, 3),
        "adaptive_threshold": round(adaptive, 3) if adaptive is not None else None,
        "tracks": n,
        "identities": len(clusters),
        "weak_tracklets": weak_count,
        "matching": (
            "camera-aware (per-camera z-scores + one-to-one cross-camera assignment)"
            if camera_aware
            else "absolute cosine (no two people ever on screen together)"
        ),
        "colour_normalised": norms is not None,
        "_embeddings": {
            "emb": emb,
            "emb_colour_normalised": np.stack(alt_embeddings) if alt_embeddings else emb,
            "camera": np.array([it.camera_id for it in items]),
            "local_track": np.array([it.state.local_track_id for it in items]),
            "start": np.array([it.state.start_time for it in items]),
            "end": np.array([it.state.last_time for it in items]),
            "weak": np.array([it.weak for it in items]),
            "weight": np.array([it.weight for it in items]),
        },
        "similarity_matrix": {
            "tracks": [f"{it.camera_id[-2:]}:L{it.state.local_track_id}{'w' if it.weak else ''}" for it in items],
            "values": np.round(sim, 3).tolist(),
        },
        "weak_unlabelled": unassigned,
        "per_track": [
            {
                "camera": it.camera_id,
                "local_track": it.state.local_track_id,
                "global_id": it.state.global_id,
                "weak": it.weak,
                "best_crop_score": round(max(s for _, s in it.state.crop_samples), 3),
            }
            for it in items
        ],
        "same_camera_cannot_links": int(np.triu(cannot, 1).sum()),
        "different_person_similarity": (
            {
                "median": round(float(np.median(negatives)), 3),
                "p90": round(float(np.percentile(negatives, 90)), 3),
                "max": round(float(negatives.max()), 3),
            }
            if negatives.size
            else None
        ),
    }
    print(f"[Re-ID] joint clustering: { {k: v for k, v in info.items() if k not in ('per_track', 'similarity_matrix', '_embeddings')} }")
    return info

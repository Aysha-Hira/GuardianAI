from __future__ import annotations

import numpy as np

from experiments.multicam.camera_tracker import FrameAnnotation, TrackState
from experiments.multicam.track_embedding import build_track_embedding
from experiments.reid.osnet_extractor import OSNetExtractor

MERGE_MIN_CROPS = 3


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def _ensure_embedding(
    state: TrackState,
    reid: OSNetExtractor,
    *,
    min_crops: int,
    max_crops: int,
) -> np.ndarray | None:
    if state.embedding is not None:
        return state.embedding
    if len(state.crop_samples) < min_crops:
        return None
    try:
        state.embedding = build_track_embedding(
            reid, state.crop_samples, min_crops=min_crops, max_crops=max_crops
        )
    except ValueError:
        return None
    return state.embedding


def _gap_is_solo_reentry(
    earlier: TrackState,
    later: TrackState,
    all_tracks: list[TrackState],
    *,
    max_gap_seconds: float,
) -> bool:
    gap_start = earlier.last_time
    gap_end = later.start_time
    if gap_end - gap_start > max_gap_seconds or gap_end <= gap_start:
        return False
    for other in all_tracks:
        if other.local_track_id in (earlier.local_track_id, later.local_track_id):
            continue
        overlaps = other.start_time <= gap_end and other.last_time >= gap_start
        if overlaps:
            return False
    return True


def merge_fragmented_local_tracks(
    tracks: dict[int, TrackState],
    annotations_by_frame: dict[int, list[FrameAnnotation]],
    reid: OSNetExtractor,
    *,
    min_crops: int = MERGE_MIN_CROPS,
    max_crops: int = 10,
    max_gap_seconds: float = 2.5,
    min_similarity: float = 0.42,
) -> dict[int, int]:
    if len(tracks) < 2:
        return {}

    ordered = sorted(tracks.values(), key=lambda s: s.start_time)
    parent: dict[int, int] = {s.local_track_id: s.local_track_id for s in ordered}

    def find(tid: int) -> int:
        while parent[tid] != tid:
            parent[tid] = parent[parent[tid]]
            tid = parent[tid]
        return tid

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if tracks[ra].start_time <= tracks[rb].start_time:
            parent[rb] = ra
        else:
            parent[ra] = rb

    embeddings: dict[int, np.ndarray | None] = {}
    for state in ordered:
        embeddings[state.local_track_id] = _ensure_embedding(
            state, reid, min_crops=min_crops, max_crops=max_crops
        )

    for i, earlier in enumerate(ordered):
        for later in ordered[i + 1 :]:
            gap = later.start_time - earlier.last_time
            if gap < 0:
                continue
            if gap > max_gap_seconds:
                break

            emb_a = embeddings.get(earlier.local_track_id)
            emb_b = embeddings.get(later.local_track_id)
            if emb_a is not None and emb_b is not None and _cosine(emb_a, emb_b) >= min_similarity:
                union(earlier.local_track_id, later.local_track_id)
                continue

            if _gap_is_solo_reentry(earlier, later, ordered, max_gap_seconds=max_gap_seconds):
                union(earlier.local_track_id, later.local_track_id)

    alias = {tid: find(tid) for tid in tracks}
    merges = {tid: canonical for tid, canonical in alias.items() if canonical != tid}
    if not merges:
        return {}

    for cid in set(alias.values()):
        cluster = [tracks[tid] for tid in tracks if alias[tid] == cid]
        if len(cluster) <= 1:
            continue
        cluster.sort(key=lambda s: s.start_time)
        primary = cluster[0]
        primary.global_id = None
        primary.assigned = False
        primary.embedding = None
        primary.eligible = False
        for frag in cluster[1:]:
            primary.frames_seen += frag.frames_seen
            primary.last_time = max(primary.last_time, frag.last_time)
            primary.crop_samples.extend(frag.crop_samples)
        primary.crop_samples.sort(key=lambda s: s[1], reverse=True)

    for tid in list(tracks.keys()):
        if alias[tid] != tid:
            del tracks[tid]

    for frame_idx, anns in annotations_by_frame.items():
        annotations_by_frame[frame_idx] = [
            FrameAnnotation(
                local_track_id=alias[ann.local_track_id],
                global_id=tracks[alias[ann.local_track_id]].global_id,
                bbox=ann.bbox,
                confidence=ann.confidence,
            )
            for ann in anns
        ]

    return merges

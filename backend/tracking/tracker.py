from __future__ import annotations

import itertools
import logging
import math
import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from deep_sort_realtime.deepsort_tracker import DeepSort

from detection import bbox_iou, is_plausible_person_box, is_plausible_vehicle_box, vehicle_boxes_duplicate

logger = logging.getLogger("guardian.tracking")


def _ensure_pkg_resources() -> None:
    try:
        import pkg_resources
        return
    except ModuleNotFoundError:
        pass

    import sys
    import types
    import importlib.resources as resources

    def resource_filename(package: str, resource: str) -> str:
        return str(resources.files(package) / resource)

    shim = types.ModuleType("pkg_resources")
    shim.resource_filename = resource_filename
    sys.modules["pkg_resources"] = shim


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 0:
        return 0.0
    return float(np.dot(a, b) / denom)


HAIR_SIM_WEIGHT = 0.20
TORSO_SIM_WEIGHT = 0.28
PANTS_SIM_WEIGHT = 0.52
OVERLAP_IOU_THRESHOLD = 0.04
REGION_HIST_DIM = 22
OVERLAP_APPEARANCE_FREEZE = True
DEEP_SIM_WEIGHT = 0.75


@dataclass
class _AppearanceSignature:

    hair: np.ndarray
    torso: np.ndarray
    pants: np.ndarray
    deep: np.ndarray | None = None

    def flat(self) -> np.ndarray:
        feat = np.concatenate([self.hair, self.torso, self.pants]).astype(np.float32)
        norm = float(np.linalg.norm(feat))
        if norm > 0:
            feat /= norm
        return feat

    def similarity(self, other: _AppearanceSignature) -> float:
        colour = (
            HAIR_SIM_WEIGHT * _cosine_sim(self.hair, other.hair)
            + TORSO_SIM_WEIGHT * _cosine_sim(self.torso, other.torso)
            + PANTS_SIM_WEIGHT * _cosine_sim(self.pants, other.pants)
        )
        if self.deep is not None and other.deep is not None:
            return DEEP_SIM_WEIGHT * _cosine_sim(self.deep, other.deep) + (1.0 - DEEP_SIM_WEIGHT) * colour
        return colour


def _smooth_region(old: np.ndarray | None, new: np.ndarray, alpha: float) -> np.ndarray:
    if old is None or old.shape != new.shape:
        return new.copy()
    blended = alpha * old + (1.0 - alpha) * new
    norm = float(np.linalg.norm(blended))
    if norm > 0:
        blended /= norm
    return blended.astype(np.float32)


def _smooth_appearance(
    old: _AppearanceSignature | None, new: _AppearanceSignature, alpha: float
) -> _AppearanceSignature:
    if old is None:
        return _AppearanceSignature(
            new.hair.copy(), new.torso.copy(), new.pants.copy(),
            None if new.deep is None else new.deep.copy(),
        )
    if new.deep is None:
        deep = None if old.deep is None else old.deep.copy()
    else:
        deep = _smooth_region(old.deep, new.deep, alpha)
    return _AppearanceSignature(
        _smooth_region(old.hair, new.hair, alpha),
        _smooth_region(old.torso, new.torso, alpha),
        _smooth_region(old.pants, new.pants, alpha),
        deep,
    )


def _region_color_hist(crop: np.ndarray) -> np.ndarray:
    if crop.size == 0:
        return np.zeros(REGION_HIST_DIM, dtype=np.float32)
    small = cv2.resize(crop, (20, 28), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    sat_mask = (hsv[:, :, 1] > 28).astype(np.uint8) * 255
    dark_mask = (hsv[:, :, 1] <= 28).astype(np.uint8) * 255
    hist_h = cv2.calcHist([hsv], [0], sat_mask, [10], [0, 180]).flatten()
    hist_s = cv2.calcHist([hsv], [1], None, [6], [0, 256]).flatten()
    hist_v = cv2.calcHist([hsv], [2], dark_mask, [6], [0, 256]).flatten()
    feat = np.concatenate([hist_h, hist_s, hist_v]).astype(np.float32)
    norm = float(np.linalg.norm(feat))
    if norm > 0:
        feat /= norm
    return feat


def _appearance_for_bbox(frame, ltrb) -> _AppearanceSignature:
    x1, y1, x2, y2 = map(int, ltrb)
    height, width = frame.shape[:2]
    bh = max(1, y2 - y1)
    x1c, x2c = max(0, x1), min(width, x2)

    hair_y1 = y1 + int(bh * 0.02)
    hair_y2 = y1 + int(bh * 0.20)
    torso_y1 = y1 + int(bh * 0.20)
    torso_y2 = y1 + int(bh * 0.52)
    pants_y1 = y1 + int(bh * 0.52)
    pants_y2 = y1 + int(bh * 0.94)

    hair = frame[max(0, hair_y1) : min(height, hair_y2), x1c:x2c]
    torso = frame[max(0, torso_y1) : min(height, torso_y2), x1c:x2c]
    pants = frame[max(0, pants_y1) : min(height, pants_y2), x1c:x2c]

    return _AppearanceSignature(
        _region_color_hist(hair),
        _region_color_hist(torso),
        _region_color_hist(pants),
    )


def _appearance_for_vehicle_bbox(frame, ltrb) -> _AppearanceSignature:
    x1, y1, x2, y2 = map(int, ltrb)
    height, width = frame.shape[:2]
    crop = frame[max(0, y1) : min(height, y2), max(0, x1) : min(width, x2)]
    body = _region_color_hist(crop)
    return _AppearanceSignature(body, body, body)


def _appearance_for_track(frame, ltrb, *, vehicle: bool) -> _AppearanceSignature:
    if vehicle:
        return _appearance_for_vehicle_bbox(frame, ltrb)
    return _appearance_for_bbox(frame, ltrb)


@dataclass
class _TrackSnapshot:
    appearance: _AppearanceSignature
    center: tuple[int, int]
    bbox: tuple[int, int, int, int]
    ds_id: int = -1

    @property
    def embed(self) -> np.ndarray:
        return self.appearance.flat()


def _bbox_area(bbox: tuple[int, int, int, int]) -> int:
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def _dedupe_snapshots(
    items: list[_TrackSnapshot],
    meta: list[tuple],
    *,
    iou_thresh: float = 0.38,
    vehicle: bool = False,
) -> tuple[list[_TrackSnapshot], list[tuple]]:
    if len(items) <= 1:
        return items, meta

    order = sorted(
        range(len(items)),
        key=lambda i: (_bbox_area(items[i].bbox), meta[i][0] if meta else 0.0),
        reverse=True,
    )
    keep: list[int] = []
    for i in order:
        dup = False
        for j in keep:
            if vehicle:
                dup = vehicle_boxes_duplicate(items[i].bbox, items[j].bbox)
            elif bbox_iou(items[i].bbox, items[j].bbox) > iou_thresh:
                dup = True
            if dup:
                break
        if dup:
            continue
        keep.append(i)
    keep.sort()
    return [items[i] for i in keep], [meta[i] for i in keep]


def _dedupe_vehicle_raw(raw: list[tuple]) -> list[tuple]:
    if len(raw) <= 1:
        return raw
    order = sorted(
        range(len(raw)),
        key=lambda i: (raw[i][0][2] * raw[i][0][3], raw[i][1]),
        reverse=True,
    )
    keep: list[int] = []
    for i in order:
        x1, y1, w, h = raw[i][0]
        box = (x1, y1, x1 + w, y1 + h)
        if any(
            vehicle_boxes_duplicate(box, (raw[j][0][0], raw[j][0][1], raw[j][0][0] + raw[j][0][2], raw[j][0][1] + raw[j][0][3]))
            for j in keep
        ):
            continue
        keep.append(i)
    keep.sort()
    return [raw[i] for i in keep]


@dataclass
class _DisplayProfile:
    display_id: int
    appearance: _AppearanceSignature
    center: tuple[int, int]
    bbox: tuple[int, int, int, int]
    last_seen: float
    velocity: tuple[float, float] = (0.0, 0.0)

    @property
    def embed(self) -> np.ndarray:
        return self.appearance.flat()


def _predict_center(profile: _DisplayProfile) -> tuple[float, float]:
    return (
        profile.center[0] + profile.velocity[0],
        profile.center[1] + profile.velocity[1],
    )


def _center_dist(a: tuple[int, int], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _update_velocity(
    prev: _DisplayProfile | None, center: tuple[int, int]
) -> tuple[float, float]:
    if prev is None:
        return (0.0, 0.0)
    vx = (center[0] - prev.center[0]) * 0.45 + prev.velocity[0] * 0.55
    vy = (center[1] - prev.center[1]) * 0.45 + prev.velocity[1] * 0.55
    return (vx, vy)


class DisplayIdMapper:

    def __init__(self, *, vehicle_mode: bool = False) -> None:
        self._vehicle_mode = vehicle_mode
        self._reassoc_window = (
            VEHICLE_REASSOC_WINDOW_SEC if vehicle_mode else REASSOC_WINDOW_SEC
        )
        self._profiles: dict[int, _DisplayProfile] = {}
        self._prev_profiles: dict[int, _DisplayProfile] = {}
        self._next_display_id = 1
        self._lost: list[dict[str, Any]] = []
        self._last_result_ids: list[int] = []
        self._slot_miss: dict[int, int] = {}
        self._ds_to_display: dict[int, int] = {}
        self._roster_size = 0

    def reset(self) -> None:
        self._profiles.clear()
        self._prev_profiles.clear()
        self._next_display_id = 1
        self._lost.clear()
        self._last_result_ids.clear()
        self._slot_miss.clear()
        self._ds_to_display.clear()
        self._roster_size = 0

    def _prune_lost(self, now: float) -> None:
        self._lost = [x for x in self._lost if now - x["lost_at"] <= self._reassoc_window]

    def _compact_vehicle_result(
        self,
        items: list[_TrackSnapshot],
        result: list[int],
        new_profiles: dict[int, _DisplayProfile],
    ) -> list[int]:
        n = len(result)
        if n <= 1:
            if n == 1:
                old_id = result[0]
                if old_id != 1 and old_id in new_profiles:
                    profile = new_profiles.pop(old_id)
                    new_profiles[1] = _DisplayProfile(
                        1,
                        _AppearanceSignature(
                            profile.appearance.hair.copy(),
                            profile.appearance.torso.copy(),
                            profile.appearance.pants.copy(),
                        ),
                        profile.center,
                        profile.bbox,
                        profile.last_seen,
                        profile.velocity,
                    )
                    for ds_id, slot in list(self._ds_to_display.items()):
                        if slot == old_id:
                            self._ds_to_display[ds_id] = 1
                self._next_display_id = 2
                self._roster_size = 1
                return [1]
            return result

        order = sorted(range(n), key=lambda i: (items[i].center[0], items[i].center[1]))
        old_to_new: dict[int, int] = {}
        compacted = [0] * n
        remapped: dict[int, _DisplayProfile] = {}

        for new_id, idx in enumerate(order, start=1):
            old_id = result[idx]
            compacted[idx] = new_id
            old_to_new[old_id] = new_id
            profile = new_profiles.get(old_id)
            if profile is None:
                continue
            remapped[new_id] = _DisplayProfile(
                new_id,
                _AppearanceSignature(
                    profile.appearance.hair.copy(),
                    profile.appearance.torso.copy(),
                    profile.appearance.pants.copy(),
                ),
                profile.center,
                profile.bbox,
                profile.last_seen,
                profile.velocity,
            )

        for ds_id, old_slot in list(self._ds_to_display.items()):
            if old_slot in old_to_new:
                self._ds_to_display[ds_id] = old_to_new[old_slot]
            elif old_slot not in remapped:
                del self._ds_to_display[ds_id]

        new_profiles.clear()
        new_profiles.update(remapped)
        self._lost = []
        self._slot_miss = {
            old_to_new[k]: v for k, v in self._slot_miss.items() if k in old_to_new
        }
        self._next_display_id = n + 1
        self._roster_size = n
        return compacted

    def _register_lost(self, profile: _DisplayProfile, now: float) -> None:
        self._lost = [x for x in self._lost if x["display_id"] != profile.display_id]
        self._lost.append(
            {
                "display_id": profile.display_id,
                "appearance": _AppearanceSignature(
                    profile.appearance.hair.copy(),
                    profile.appearance.torso.copy(),
                    profile.appearance.pants.copy(),
                ),
                "center": profile.center,
                "bbox": profile.bbox,
                "lost_at": now,
            }
        )
        if DEBUG_TRACKING:
            logger.info("Track lost (re-entry window open): display #%s", profile.display_id)

    def _profile_for_slot(self, slot_id: int, now: float) -> _DisplayProfile | None:
        if slot_id in self._profiles:
            return self._profiles[slot_id]
        for entry in self._lost:
            if entry["display_id"] == slot_id:
                return _DisplayProfile(
                    slot_id,
                    entry["appearance"],
                    entry["center"],
                    entry["bbox"],
                    float(entry["lost_at"]),
                )
        return None

    def _slot_continuity_cost(
        self,
        item: _TrackSnapshot,
        profile: _DisplayProfile,
        frame_w: int,
        frame_h: int,
        *,
        overlap_scene: bool,
    ) -> float:
        iou = bbox_iou(item.bbox, profile.bbox)
        pred = _predict_center(profile)
        dist = _center_dist(item.center, pred)
        diag = max(
            math.hypot(profile.bbox[2] - profile.bbox[0], profile.bbox[3] - profile.bbox[1]),
            48.0,
        )
        dist_n = dist / diag
        sim = item.appearance.similarity(profile.appearance)
        if self._vehicle_mode:
            if overlap_scene:
                cost = (1.0 - iou) * 0.72 + dist_n * 0.28
            else:
                cost = (1.0 - iou) * 0.58 + dist_n * 0.32 + (1.0 - sim) * 0.10
            if sim < 0.30:
                cost += 0.25
            return cost
        if overlap_scene:
            cost = (1.0 - iou) * 0.62 + dist_n * 0.38
        else:
            cost = (1.0 - iou) * 0.28 + (1.0 - sim) * 0.52 + dist_n * 0.20
        if sim < REASSOC_MIN_SIM:
            cost += 1.0
        return cost

    def _known_slot_ids(self) -> list[int]:
        lost_ids = {int(x["display_id"]) for x in self._lost}
        return sorted(set(self._profiles.keys()) | lost_ids)

    def _full_slot_assignment(
        self,
        items: list[_TrackSnapshot],
        slot_ids: list[int],
        frame_w: int,
        frame_h: int,
        now: float,
        *,
        overlap_scene: bool,
    ) -> dict[int, int]:
        n = len(items)
        if n == 0 or not slot_ids:
            return {}

        best_assign: dict[int, int] = {}
        best_cost = float("inf")
        pick = min(n, len(slot_ids))

        for slot_subset in itertools.combinations(slot_ids, pick):
            for slot_perm in itertools.permutations(slot_subset):
                for det_inds in itertools.permutations(range(n), pick):
                    assign: dict[int, int] = {}
                    total = 0.0
                    valid = True
                    for det_i, slot_id in zip(det_inds, slot_perm):
                        profile = self._profile_for_slot(slot_id, now)
                        if profile is None:
                            valid = False
                            break
                        total += self._slot_continuity_cost(
                            items[det_i],
                            profile,
                            frame_w,
                            frame_h,
                            overlap_scene=overlap_scene,
                        )
                        assign[det_i] = slot_id
                    if not valid or len(assign) != pick:
                        continue
                    if total < best_cost:
                        best_cost = total
                        best_assign = assign

        return best_assign

    def _allocate_new_slot_id(self, taken: set[int] | None = None) -> int:
        reserved = set(self._profiles.keys()) | {int(x["display_id"]) for x in self._lost}
        if taken:
            reserved |= taken
        for candidate in range(1, self._next_display_id):
            if candidate not in reserved:
                return candidate
        slot = self._next_display_id
        self._next_display_id += 1
        return slot

    @staticmethod
    def _scene_overlap(items: list[_TrackSnapshot]) -> bool:
        if len(items) < 2:
            return False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                if bbox_iou(items[i].bbox, items[j].bbox) > OVERLAP_IOU_THRESHOLD:
                    return True
        return False

    def assign_frame(
        self,
        items: list[_TrackSnapshot],
        frame_w: int,
        frame_h: int,
        now: float,
    ) -> list[int]:
        self._prune_lost(now)
        n = len(items)
        if n == 0:
            for profile in self._profiles.values():
                self._register_lost(profile, now)
            self._prev_profiles = {pid: p for pid, p in self._profiles.items()}
            self._profiles.clear()
            self._slot_miss.clear()
            self._last_result_ids = []
            return []

        self._roster_size = max(self._roster_size, n)
        if len(self._lost) > self._roster_size:
            self._lost.sort(key=lambda x: float(x["lost_at"]), reverse=True)
            self._lost = self._lost[: self._roster_size]

        overlap_scene = self._scene_overlap(items)
        assigned: dict[int, int] = {}
        max_hint_cost = SLOT_OVERLAP_MAX_COST if overlap_scene else DISPLAY_MATCH_MAX_COST
        for track_idx, item in enumerate(items):
            if item.ds_id < 0:
                continue
            mapped = self._ds_to_display.get(item.ds_id)
            if mapped is None:
                continue
            if mapped in assigned.values():
                continue
            profile = self._profile_for_slot(mapped, now)
            if profile is None:
                continue
            cost = self._slot_continuity_cost(
                item, profile, frame_w, frame_h, overlap_scene=overlap_scene
            )
            if cost <= max_hint_cost:
                assigned[track_idx] = mapped

        pool = self._known_slot_ids()
        remaining = self._full_slot_assignment(
            [items[i] for i in range(n) if i not in assigned],
            [s for s in pool if s not in assigned.values()],
            frame_w,
            frame_h,
            now,
            overlap_scene=overlap_scene,
        )
        rem_indices = [i for i in range(n) if i not in assigned]
        for local_i, slot_id in remaining.items():
            assigned[rem_indices[local_i]] = slot_id

        taken = set(assigned.values())
        for track_idx in range(n):
            if track_idx in assigned:
                continue
            free_pool = [s for s in pool if s not in taken]
            if free_pool:
                best_slot: int | None = None
                best_cost = float("inf")
                for slot_id in free_pool:
                    profile = self._profile_for_slot(slot_id, now)
                    if profile is None:
                        continue
                    cost = self._slot_continuity_cost(
                        items[track_idx],
                        profile,
                        frame_w,
                        frame_h,
                        overlap_scene=overlap_scene,
                    )
                    if cost < best_cost:
                        best_cost = cost
                        best_slot = slot_id
                if best_slot is not None:
                    assigned[track_idx] = best_slot
                    taken.add(best_slot)
                    continue
            if len(taken) < self._roster_size:
                slot_id = self._allocate_new_slot_id(taken)
                assigned[track_idx] = slot_id
                taken.add(slot_id)
                if DEBUG_TRACKING:
                    logger.info("Track created: display #%s", slot_id)

        for slot_id in set(assigned.values()):
            self._lost = [x for x in self._lost if x["display_id"] != slot_id]

        result = [assigned[i] for i in range(n)]
        new_profiles: dict[int, _DisplayProfile] = {}
        matched_slots: set[int] = set()

        for track_idx, display_id in enumerate(result):
            item = items[track_idx]
            if item.ds_id >= 0:
                self._ds_to_display[item.ds_id] = display_id
            prev = self._profiles.get(display_id)
            if prev is None:
                prev = self._profile_for_slot(display_id, now)
            velocity = _update_velocity(prev, item.center)
            if overlap_scene and OVERLAP_APPEARANCE_FREEZE and prev is not None:
                smoothed = prev.appearance
            else:
                smoothed = _smooth_appearance(
                    prev.appearance if prev else None,
                    item.appearance,
                    OUTFIT_EMBED_EMA,
                )
            new_profiles[display_id] = _DisplayProfile(
                display_id,
                _AppearanceSignature(
                    smoothed.hair.copy(),
                    smoothed.torso.copy(),
                    smoothed.pants.copy(),
                    None if smoothed.deep is None else smoothed.deep.copy(),
                ),
                item.center,
                item.bbox,
                now,
                velocity,
            )
            matched_slots.add(display_id)
            self._slot_miss.pop(display_id, None)

        for pid, profile in self._profiles.items():
            if pid in matched_slots:
                continue
            misses = self._slot_miss.get(pid, 0) + 1
            self._slot_miss[pid] = misses
            if misses < SLOT_LOST_FRAMES:
                new_profiles[pid] = _DisplayProfile(
                    pid,
                    _AppearanceSignature(
                        profile.appearance.hair.copy(),
                        profile.appearance.torso.copy(),
                        profile.appearance.pants.copy(),
                    ),
                    profile.center,
                    profile.bbox,
                    profile.last_seen,
                    profile.velocity,
                )
            else:
                self._register_lost(profile, now)
                self._slot_miss.pop(pid, None)

        stale_ds = [ds for ds, sid in self._ds_to_display.items() if sid not in new_profiles]
        for ds in stale_ds:
            del self._ds_to_display[ds]

        self._prev_profiles = {pid: p for pid, p in self._profiles.items()}
        self._profiles = new_profiles
        self._last_result_ids = list(result)
        return result


DEBUG_TRACKING = os.getenv("GUARDIAN_DEBUG_TRACKING", "0") == "1"
SHOW_TRAILS = os.getenv("GUARDIAN_SHOW_TRAILS", "0") == "1"
TRAIL_MAX_POINTS = int(os.getenv("GUARDIAN_TRAIL_MAX_POINTS", "72"))
TRAIL_MIN_STEP_PX = int(os.getenv("GUARDIAN_TRAIL_MIN_STEP", "3"))
TRACKER_MAX_AGE = int(os.getenv("GUARDIAN_TRACKER_MAX_AGE", "120"))
TRACKER_N_INIT = int(os.getenv("GUARDIAN_TRACKER_N_INIT", "3"))
TRACK_COAST_FRAMES = int(os.getenv("GUARDIAN_TRACK_COAST_FRAMES", "12"))
REASSOC_WINDOW_SEC = float(os.getenv("GUARDIAN_REASSOC_WINDOW", "30"))
REASSOC_MIN_SIM = float(os.getenv("GUARDIAN_REASSOC_MIN_SIM", "0.68"))
DISPLAY_MATCH_MAX_COST = float(os.getenv("GUARDIAN_DISPLAY_MATCH_MAX_COST", "0.72"))
SLOT_STICKY_MIN_SIM = float(os.getenv("GUARDIAN_SLOT_STICKY_MIN_SIM", "0.52"))
SLOT_OVERLAP_MAX_COST = float(os.getenv("GUARDIAN_SLOT_OVERLAP_MAX_COST", "0.96"))
SLOT_LOST_FRAMES = int(os.getenv("GUARDIAN_SLOT_LOST_FRAMES", "12"))
OUTFIT_EMBED_EMA = float(os.getenv("GUARDIAN_OUTFIT_EMBED_EMA", "0.88"))
DEDUPE_IOU = float(os.getenv("GUARDIAN_TRACK_DEDUPE_IOU", "0.38"))
VEHICLE_TRACKER_MAX_AGE = int(os.getenv("GUARDIAN_VEHICLE_TRACKER_MAX_AGE", "150"))
VEHICLE_TRACKER_N_INIT = int(os.getenv("GUARDIAN_VEHICLE_TRACKER_N_INIT", "3"))
VEHICLE_TRACK_COAST_FRAMES = int(os.getenv("GUARDIAN_VEHICLE_TRACK_COAST_FRAMES", "18"))
VEHICLE_DEDUPE_IOU = float(os.getenv("GUARDIAN_VEHICLE_DEDUPE_IOU", "0.42"))
VEHICLE_REASSOC_WINDOW_SEC = float(os.getenv("GUARDIAN_VEHICLE_REASSOC_WINDOW", "6"))
VEHICLE_MIN_TRACK_CONF = float(os.getenv("GUARDIAN_VEHICLE_MIN_TRACK_CONF", "0.38"))
STATE_CLEANUP_SEC = REASSOC_WINDOW_SEC
USE_MOBILENET = os.getenv("GUARDIAN_USE_MOBILENET", "0") == "1"


def _has_torch_gpu() -> bool:
    try:
        from inference_device import resolve_inference_device

        return resolve_inference_device() != "cpu"
    except Exception:
        return False


@dataclass
class TrackResult:

    track_id: int
    confidence: float
    bbox: tuple[int, int, int, int]
    center: tuple[int, int]
    bottom_center: tuple[int, int]
    class_name: str = "person"
    visible_duration: float = 0.0
    status: str = "Visible"
    trail: list[tuple[int, int]] = field(default_factory=list)
    in_zone: bool = False
    zone_status: str = "outside"
    inside_zone_duration: float = 0.0
    loitering_detected: bool = False
    loitering_threshold_seconds: float = 15.0
    coasting: bool = False


class TrackStateManager:

    def __init__(self) -> None:
        self._records: dict[int, dict[str, Any]] = {}

    def reset(self) -> None:
        self._records.clear()

    def update(self, tracks: list[TrackResult], now: float | None = None) -> list[TrackResult]:
        now = now if now is not None else time.time()
        visible_ids: set[int] = set()

        for track in tracks:
            tid = track.track_id
            visible_ids.add(tid)

            if tid not in self._records:
                self._records[tid] = {
                    "first_seen": now,
                    "last_seen": now,
                    "trail": deque(maxlen=TRAIL_MAX_POINTS),
                    "class_votes": {},
                }

            rec = self._records[tid]
            rec["last_seen"] = now
            raw_class = getattr(track, "class_name", "person")
            if raw_class != "person":
                votes: dict[str, int] = rec.setdefault("class_votes", {})
                votes[str(raw_class)] = votes.get(str(raw_class), 0) + 1
                track.class_name = max(
                    votes.items(),
                    key=lambda item: (item[1], item[0] == "car"),
                )[0]
            point = track.bottom_center
            trail: deque = rec["trail"]
            if trail:
                lx, ly = trail[-1]
                dx, dy = point[0] - lx, point[1] - ly
                if (dx * dx + dy * dy) >= TRAIL_MIN_STEP_PX * TRAIL_MIN_STEP_PX:
                    trail.append(point)
            else:
                trail.append(point)

            track.visible_duration = now - rec["first_seen"]
            track.status = "Visible"
            track.trail = list(rec["trail"])

        for tid in list(self._records.keys()):
            if tid not in visible_ids and now - self._records[tid]["last_seen"] > STATE_CLEANUP_SEC:
                if DEBUG_TRACKING:
                    logger.info("Track lost: #%s", tid)
                del self._records[tid]

        return tracks

    def active_track_summaries(self, tracks: list[TrackResult]) -> list[dict[str, Any]]:
        summaries = []
        for t in sorted(tracks, key=lambda x: x.track_id):
            item = {
                "track_id": t.track_id,
                "status": t.status,
                "visible_duration": round(t.visible_duration, 1),
                "confidence": round(t.confidence, 2),
                "class_name": getattr(t, "class_name", "person"),
            }
            if getattr(t, "in_zone", False):
                item["in_zone"] = True
                item["inside_zone_duration"] = round(getattr(t, "inside_zone_duration", 0.0), 1)
                item["loitering_threshold_seconds"] = round(
                    getattr(t, "loitering_threshold_seconds", 15.0), 1
                )
                if getattr(t, "loitering_detected", False):
                    item["loitering_detected"] = True
                    item["zone_status"] = "loitering"
            summaries.append(item)
        return summaries


class PersonTracker:

    def __init__(self, *, kind: str = "person", relaxed: bool = False) -> None:
        self._kind = kind
        self._vehicle_mode = kind == "vehicle"
        self._relaxed = relaxed and not self._vehicle_mode
        self._pseudo_embeds = False
        self._deep_embeds = False
        self._deepsort = self._create_deepsort()
        self._state = TrackStateManager()
        self._display_ids = DisplayIdMapper(vehicle_mode=self._vehicle_mode)
        self._show_trails = SHOW_TRAILS
        self._last_active_count = 0
        self._coast_frames = (
            VEHICLE_TRACK_COAST_FRAMES if self._vehicle_mode else TRACK_COAST_FRAMES
        )
        self._dedupe_iou = VEHICLE_DEDUPE_IOU if self._vehicle_mode else DEDUPE_IOU

    def _create_deepsort(self) -> DeepSort:
        if self._vehicle_mode:
            common = dict(
                max_age=VEHICLE_TRACKER_MAX_AGE,
                n_init=VEHICLE_TRACKER_N_INIT,
                max_iou_distance=0.65,
                max_cosine_distance=0.48,
                half=True,
                bgr=True,
            )
            self._pseudo_embeds = True
            logger.info("Vehicle DeepSORT (IoU + Kalman, motion-weighted display IDs)")
            return DeepSort(embedder=None, **common)

        common = dict(
            max_age=TRACKER_MAX_AGE,
            n_init=TRACKER_N_INIT,
            max_iou_distance=0.55,
            max_cosine_distance=0.38,
            half=True,
            bgr=True,
        )

        if USE_MOBILENET and _has_torch_gpu():
            _ensure_pkg_resources()
            try:
                tracker = DeepSort(embedder="mobilenet", embedder_gpu=True, **common)
                self._pseudo_embeds = False
                logger.info("DeepSORT using MobileNet embedder (GPU)")
                return tracker
            except Exception as exc:
                logger.warning("MobileNet GPU embedder failed (%s); using fast pseudo-embeddings", exc)

        self._pseudo_embeds = True
        from tracking import live_reid

        self._deep_embeds = live_reid.available()
        if self._deep_embeds:
            logger.info("DeepSORT using OSNet Re-ID embeddings (person appearance)")
        else:
            logger.info("DeepSORT using fast pseudo-embeddings (IoU + Kalman + re-entry matching)")
        return DeepSort(embedder=None, **common)

    @staticmethod
    def _embed_for_bbox(frame, ltrb, *, vehicle: bool = False) -> np.ndarray:
        return _appearance_for_track(frame, ltrb, vehicle=vehicle).flat()

    def _generate_pseudo_embeds(self, frame, raw_dets: list[tuple]) -> list[np.ndarray]:
        embeds: list[np.ndarray] = []
        for det in raw_dets:
            left, top, bw, bh = [int(v) for v in det[0]]
            x2, y2 = left + bw, top + bh
            embeds.append(
                _appearance_for_track(
                    frame, (left, top, x2, y2), vehicle=self._vehicle_mode
                ).flat()
            )
        return embeds

    @property
    def show_trails(self) -> bool:
        return self._show_trails

    def set_show_trails(self, enabled: bool) -> None:
        self._show_trails = enabled

    def reset(self) -> None:
        self._deepsort = self._create_deepsort()
        self._state.reset()
        self._display_ids.reset()
        self._last_active_count = 0
        if DEBUG_TRACKING:
            logger.info("Tracker reset")

    def update(self, frame, detections: list[tuple], timestamp: float | None = None) -> list[TrackResult]:
        raw: list[tuple] = []
        frame_h, frame_w = frame.shape[:2]
        default_class = "vehicle" if self._vehicle_mode else "person"
        for det in detections:
            if len(det) >= 6:
                x1, y1, x2, y2, conf, class_name = det[:6]
                class_name = str(class_name or default_class)
            else:
                x1, y1, x2, y2, conf = det[:5]
                class_name = default_class
            w, h = x2 - x1, y2 - y1
            if w <= 0 or h <= 0:
                continue
            if self._vehicle_mode:
                if not is_plausible_vehicle_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif class_name == "person" and not self._relaxed:
                if not is_plausible_person_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif class_name == "person" and self._relaxed:
                from experiments.multicam.offline_detection import is_plausible_offline_person_box

                if not is_plausible_offline_person_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif not is_plausible_vehicle_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                continue
            raw.append(([x1, y1, w, h], conf, class_name))

        if self._vehicle_mode and len(raw) > 1:
            raw = _dedupe_vehicle_raw(raw)

        try:
            det_deep = None
            if self._pseudo_embeds and self._deep_embeds:
                from tracking import live_reid

                det_boxes = [
                    (int(d[0][0]), int(d[0][1]), int(d[0][0] + d[0][2]), int(d[0][1] + d[0][3])) for d in raw
                ]
                det_deep = live_reid.embed_boxes(frame, det_boxes)
                if det_deep is None:
                    self._deepsort = self._create_deepsort()
                    self._deep_embeds = False
            if self._pseudo_embeds and det_deep is not None:
                self._last_det_boxes = det_boxes
                self._last_det_deep = det_deep
                tracks = self._deepsort.update_tracks(raw, embeds=[e for e in det_deep])
            elif self._pseudo_embeds:
                self._last_det_boxes, self._last_det_deep = [], None
                embeds = self._generate_pseudo_embeds(frame, raw)
                tracks = self._deepsort.update_tracks(raw, embeds=embeds)
            else:
                tracks = self._deepsort.update_tracks(raw, frame=frame)
        except Exception:
            logger.exception("Tracker update failed")
            return []

        visible = [
            t for t in tracks
            if t.is_confirmed() and getattr(t, "time_since_update", 99) <= self._coast_frames
        ]
        now = timestamp if timestamp is not None else time.time()
        snapshots: list[_TrackSnapshot] = []
        meta: list[tuple] = []

        for track in visible:
            x1, y1, x2, y2 = map(int, track.to_ltrb())
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            tsu = int(getattr(track, "time_since_update", 0))
            coasting = tsu > 0
            conf = float(track.det_conf) if track.det_conf is not None else 0.0
            if coasting and conf <= 0:
                conf = 0.4
            class_name = getattr(track, "det_class", None) or getattr(track, "class_name", None) or default_class
            if self._vehicle_mode:
                if not is_plausible_vehicle_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif class_name == "person" and not self._relaxed:
                if not is_plausible_person_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif class_name == "person" and self._relaxed:
                from experiments.multicam.offline_detection import is_plausible_offline_person_box

                if not is_plausible_offline_person_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                    continue
            elif not is_plausible_vehicle_box(x1, y1, x2, y2, frame_w, frame_h, conf):
                continue
            appearance = _appearance_for_track(
                frame, (x1, y1, x2, y2), vehicle=self._vehicle_mode
            )
            if not coasting and getattr(self, "_last_det_deep", None) is not None:
                best_iou, best_k = 0.5, -1
                for k, db in enumerate(self._last_det_boxes):
                    iou = bbox_iou((x1, y1, x2, y2), db)
                    if iou > best_iou:
                        best_iou, best_k = iou, k
                if best_k >= 0:
                    appearance.deep = self._last_det_deep[best_k]
            bbox = (x1, y1, x2, y2)
            ds_id = int(getattr(track, "track_id", -1) or -1)
            snapshots.append(_TrackSnapshot(appearance, (cx, cy), bbox, ds_id=ds_id))
            meta.append((conf, coasting, cx, cy, y2, class_name))

        snapshots, meta = _dedupe_snapshots(
            snapshots, meta, iou_thresh=self._dedupe_iou, vehicle=self._vehicle_mode
        )

        display_ids = self._display_ids.assign_frame(snapshots, frame_w, frame_h, now)

        results: list[TrackResult] = []
        for display_id, (conf, coasting, cx, cy, y2, class_name), snap in zip(
            display_ids, meta, snapshots, strict=True
        ):
            x1, y1, x2, y2 = snap.bbox
            results.append(
                TrackResult(
                    track_id=display_id,
                    confidence=conf,
                    bbox=(x1, y1, x2, y2),
                    center=(cx, cy),
                    bottom_center=(cx, y2),
                    coasting=coasting,
                    class_name="car" if self._vehicle_mode else str(class_name or "person"),
                )
            )

        results = self._state.update(results, now=now)

        if DEBUG_TRACKING and len(results) != self._last_active_count:
            logger.info("Active tracks: %s", len(results))
            self._last_active_count = len(results)

        return results

    def get_track_summaries(self, tracks: list[TrackResult]) -> list[dict[str, Any]]:
        return self._state.active_track_summaries(tracks)

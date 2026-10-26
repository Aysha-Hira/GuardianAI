from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass
class LocalTrackRef:
    camera_id: str
    local_track_id: int
    start_time: float
    end_time: float


@dataclass
class GlobalIdentity:
    global_id: int
    representative_embedding: np.ndarray
    last_seen_camera: str
    last_seen_time: float
    recent_local_tracks: list[LocalTrackRef] = field(default_factory=list)
    appearance_samples: int = 0
    created_at: float = field(default_factory=time.time)

    def update(
        self,
        embedding: np.ndarray,
        camera_id: str,
        local_track_id: int,
        timestamp: float,
        *,
        n_samples: int,
    ) -> None:
        alpha = min(0.35, n_samples / (n_samples + 10.0))
        combined = (1.0 - alpha) * self.representative_embedding + alpha * embedding
        norm = float(np.linalg.norm(combined))
        if norm > 0:
            combined = combined / norm
        self.representative_embedding = combined.astype(np.float32)
        self.last_seen_camera = camera_id
        self.last_seen_time = timestamp
        self.appearance_samples += n_samples
        self.recent_local_tracks.append(
            LocalTrackRef(camera_id, local_track_id, timestamp, timestamp)
        )


class GlobalIdentityManager:
    def __init__(self) -> None:
        self._identities: dict[int, GlobalIdentity] = {}
        self._next_id = 1
        self._assignments: dict[tuple[str, int], int] = {}
        self._transitions: list[dict[str, Any]] = []

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b))

    def get_global_id(self, camera_id: str, local_track_id: int) -> int | None:
        return self._assignments.get((camera_id, local_track_id))

    def register_track(
        self,
        camera_id: str,
        local_track_id: int,
        track_embedding: np.ndarray,
        timestamp: float,
        *,
        threshold: float,
        max_gap_seconds: float,
        n_crops: int,
        debug: bool = True,
    ) -> tuple[int, dict[str, Any]]:
        key = (camera_id, local_track_id)
        if key in self._assignments:
            gid = self._assignments[key]
            info = {"decision": "ALREADY_ASSIGNED", "global_id": gid}
            return gid, info

        best_gid: int | None = None
        best_sim = -1.0
        best_gap = float("inf")

        for gid, ident in self._identities.items():
            if ident.last_seen_camera == camera_id:
                continue
            sim = self.cosine_similarity(track_embedding, ident.representative_embedding)
            gap = timestamp - ident.last_seen_time
            if gap < 0:
                gap = abs(gap)
            if gap > max_gap_seconds:
                continue
            if sim > best_sim:
                best_sim = sim
                best_gid = gid
                best_gap = gap

        same_cam_gid: int | None = None
        same_cam_sim = -1.0
        same_cam_gap = float("inf")
        for gid, ident in self._identities.items():
            if ident.last_seen_camera != camera_id:
                continue
            sim = self.cosine_similarity(track_embedding, ident.representative_embedding)
            gap = timestamp - ident.last_seen_time
            if gap <= 0.05 or gap > max_gap_seconds:
                continue
            if sim > same_cam_sim:
                same_cam_sim = sim
                same_cam_gid = gid
                same_cam_gap = gap

        meta: dict[str, Any] = {
            "camera_id": camera_id,
            "local_track_id": local_track_id,
            "best_global_candidate": best_gid,
            "cosine_similarity": round(best_sim, 4) if best_gid is not None else None,
            "threshold": threshold,
            "time_gap_seconds": round(best_gap, 2) if best_gid is not None else None,
            "same_camera_candidate": same_cam_gid,
            "same_camera_similarity": round(same_cam_sim, 4) if same_cam_gid is not None else None,
        }

        if best_gid is not None and best_sim >= threshold:
            gid = best_gid
            meta["decision"] = "MATCH"
            prev = self._identities[gid]
            if prev.last_seen_camera != camera_id:
                self._transitions.append(
                    {
                        "global_id": gid,
                        "from_camera": prev.last_seen_camera,
                        "from_local_track": self._last_local_track_for(gid, prev.last_seen_camera),
                        "to_camera": camera_id,
                        "to_local_track": local_track_id,
                        "similarity": round(best_sim, 4),
                        "time_gap_seconds": round(best_gap, 2),
                    }
                )
            prev.update(track_embedding, camera_id, local_track_id, timestamp, n_samples=n_crops)
        elif same_cam_gid is not None and same_cam_sim >= threshold:
            gid = same_cam_gid
            meta["decision"] = "SAME_CAMERA_RELINK"
            meta["time_gap_seconds"] = round(same_cam_gap, 2)
            meta["cosine_similarity"] = round(same_cam_sim, 4)
            self._identities[gid].update(
                track_embedding, camera_id, local_track_id, timestamp, n_samples=n_crops
            )
        else:
            gid = self._next_id
            self._next_id += 1
            meta["decision"] = "NEW GLOBAL ID"
            self._identities[gid] = GlobalIdentity(
                global_id=gid,
                representative_embedding=track_embedding.copy(),
                last_seen_camera=camera_id,
                last_seen_time=timestamp,
                appearance_samples=n_crops,
                recent_local_tracks=[
                    LocalTrackRef(camera_id, local_track_id, timestamp, timestamp)
                ],
            )

        self._assignments[key] = gid
        meta["global_id"] = gid
        if debug:
            print(
                f"[Re-ID] {camera_id} Track #{local_track_id} | "
                f"Best Global Candidate: #{meta.get('best_global_candidate')} | "
                f"Cosine Similarity: {meta.get('cosine_similarity')} | "
                f"Threshold: {threshold} | "
                f"Time gap: {meta.get('time_gap_seconds')}s | "
                f"Decision: {meta['decision']} -> Global #{gid}"
            )
        return gid, meta

    def _last_local_track_for(self, gid: int, camera_id: str) -> int | None:
        ident = self._identities.get(gid)
        if ident is None:
            return None
        for ref in reversed(ident.recent_local_tracks):
            if ref.camera_id == camera_id:
                return ref.local_track_id
        return None

    @property
    def identities(self) -> dict[int, GlobalIdentity]:
        return self._identities

    @property
    def transitions(self) -> list[dict[str, Any]]:
        return self._transitions

    @property
    def assignments(self) -> dict[tuple[str, int], int]:
        return self._assignments

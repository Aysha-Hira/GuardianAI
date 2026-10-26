from __future__ import annotations

from experiments.multicam.camera_tracker import FrameAnnotation, TrackState
from experiments.multicam.global_identity import GlobalIdentityManager
from experiments.multicam.track_embedding import build_track_embedding
from experiments.reid.osnet_extractor import OSNetExtractor


def apply_global_ids_to_annotations(
    tracks: dict[int, TrackState],
    annotations_by_frame: dict[int, list[FrameAnnotation]],
) -> None:
    for frame_idx, anns in annotations_by_frame.items():
        annotations_by_frame[frame_idx] = [
            FrameAnnotation(
                local_track_id=ann.local_track_id,
                global_id=tracks[ann.local_track_id].global_id
                if ann.local_track_id in tracks
                else ann.global_id,
                bbox=ann.bbox,
                confidence=ann.confidence,
            )
            for ann in anns
        ]


def assign_global_ids_for_camera(
    camera_id: str,
    tracks: dict[int, TrackState],
    annotations_by_frame: dict[int, list[FrameAnnotation]],
    global_manager: GlobalIdentityManager,
    reid: OSNetExtractor,
    *,
    match_threshold: float,
    max_gap_seconds: float,
    min_crops: int = 3,
    max_crops: int = 10,
) -> None:
    ordered = sorted(tracks.values(), key=lambda s: (s.start_time, s.local_track_id))
    for state in ordered:
        if len(state.crop_samples) < min_crops:
            continue
        try:
            embedding = build_track_embedding(
                reid,
                state.crop_samples,
                min_crops=min_crops,
                max_crops=max_crops,
            )
        except ValueError:
            continue

        gid, _ = global_manager.register_track(
            camera_id,
            state.local_track_id,
            embedding,
            state.start_time,
            threshold=match_threshold,
            max_gap_seconds=max_gap_seconds,
            n_crops=len(state.crop_samples),
        )
        state.global_id = gid
        state.assigned = True
        state.embedding = embedding
        state.eligible = True

    apply_global_ids_to_annotations(tracks, annotations_by_frame)

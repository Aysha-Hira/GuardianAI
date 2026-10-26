from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass
class GTPersonSpan:
    person_id: int
    start_frame: int
    end_frame: int


def parse_mot_gt(path: str | Path, *, fps: float = 25.0) -> dict[int, GTPersonSpan]:
    spans: dict[int, list[int]] = defaultdict(list)
    with Path(path).open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            if len(parts) < 2:
                continue
            try:
                frame = int(float(parts[0]))
                person_id = int(float(parts[1]))
            except ValueError:
                continue
            spans[person_id].append(frame)

    out: dict[int, GTPersonSpan] = {}
    for pid, frames in spans.items():
        out[pid] = GTPersonSpan(pid, min(frames), max(frames))
    return out


def gt_frame_span(path: str | Path) -> dict[str, int | list[dict[str, int]]] | None:
    p = Path(path)
    if not p.is_file():
        return None
    people = parse_mot_gt(p)
    if not people:
        return None
    starts = [s.start_frame for s in people.values()]
    ends = [s.end_frame for s in people.values()]
    return {
        "people_count": len(people),
        "first_person_frame": min(starts),
        "last_person_frame": max(ends),
        "recommended_min_frames": max(ends) + 50,
        "people": [
            {"person_id": pid, "start_frame": span.start_frame, "end_frame": span.end_frame}
            for pid, span in sorted(people.items())
        ],
    }


def evaluate_cross_camera_pairs(
    assignments_cam1: dict[int, int],
    assignments_cam2: dict[int, int],
    track_spans_cam1: dict[int, tuple[int, int]],
    track_spans_cam2: dict[int, tuple[int, int]],
    gt_spans: dict[int, GTPersonSpan],
    *,
    fps: float = 25.0,
) -> dict:
    gt_ids = list(gt_spans.keys())

    predicted_pairs: list[tuple[int, int, int]] = []
    for lt1, gid1 in assignments_cam1.items():
        for lt2, gid2 in assignments_cam2.items():
            if gid1 == gid2:
                predicted_pairs.append((lt1, lt2, gid1))

    correct = 0
    incorrect = 0
    missed = 0
    tested = 0

    for pid, span in gt_spans.items():
        c1_tracks = [
            lt for lt, (s, e) in track_spans_cam1.items() if not (e < span.start_frame or s > span.end_frame)
        ]
        c2_tracks = [
            lt for lt, (s, e) in track_spans_cam2.items() if not (e < span.start_frame or s > span.end_frame)
        ]
        if not c1_tracks or not c2_tracks:
            continue
        tested += 1
        matched = False
        for lt1 in c1_tracks:
            for lt2 in c2_tracks:
                g1 = assignments_cam1.get(lt1)
                g2 = assignments_cam2.get(lt2)
                if g1 is not None and g1 == g2:
                    correct += 1
                    matched = True
                elif g1 is not None and g2 is not None and g1 != g2:
                    incorrect += 1
        if not matched:
            missed += 1

    precision = correct / max(correct + incorrect, 1)
    recall = correct / max(correct + missed, 1)

    return {
        "gt_persons_with_both_cameras": tested,
        "correct_pairs": correct,
        "incorrect_pairs": incorrect,
        "missed_pairs": missed,
        "pair_precision": round(precision, 4),
        "pair_recall": round(recall, 4),
        "predicted_cross_camera_links": len(predicted_pairs),
        "note": (
            "CITIC GT is waypoint-based (not per-camera bbox). "
            "Metrics use temporal overlap proxy — see data/multicam/README.md."
        ),
    }


def similarity_analysis_rows(
    same_sims: list[float],
    diff_sims: list[float],
) -> list[dict]:
    rows = []
    for label, vals in [("same_person", same_sims), ("different_person", diff_sims)]:
        for v in vals:
            rows.append({"pair_type": label, "cosine_similarity": round(v, 4)})
    return rows

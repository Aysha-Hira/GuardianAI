from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger("guardian.focus.face")

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
YUNET_PATH = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
SCAN_MAX_WIDTH = int(os.getenv("GUARDIAN_FACE_SCAN_WIDTH", "480"))
SCAN_CACHE_SEC = float(os.getenv("GUARDIAN_FACE_SCAN_CACHE_SEC", "0.12"))

FACE_HEIGHT_IN_CROP = 0.30
FACE_Y_IN_CROP = 0.36


@dataclass(frozen=True)
class FaceHit:
    cx: float
    cy: float
    bbox: tuple[int, int, int, int]
    confidence: float


class FaceFinder:

    def __init__(self) -> None:
        self._detector: cv2.FaceDetectorYN | None = None
        self._load_error: str | None = None
        self._input_size: tuple[int, int] = (320, 320)

    def _ensure_loaded(self) -> bool:
        if self._detector is not None:
            return True
        if self._load_error is not None:
            return False
        if not YUNET_PATH.is_file():
            self._load_error = f"missing YuNet model: {YUNET_PATH}"
            logger.warning(self._load_error)
            return False
        try:
            detector = cv2.FaceDetectorYN.create(
                str(YUNET_PATH),
                "",
                self._input_size,
                score_threshold=0.45,
                nms_threshold=0.35,
                top_k=5000,
            )
        except cv2.error as exc:
            self._load_error = str(exc)
            logger.warning("YuNet load failed: %s", exc)
            return False
        self._detector = detector
        return True

    @staticmethod
    def _search_roi(
        frame_w: int,
        frame_h: int,
        person_bbox: tuple[int, int, int, int],
        *,
        tight: bool = False,
    ) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = person_bbox
        bw = max(24, x2 - x1)
        bh = max(40, y2 - y1)
        if tight:
            sx1 = x1
            sx2 = x2
            sy1 = max(0, y1 - int(bh * 0.12))
            sy2 = min(frame_h, y1 + int(bh * 0.36))
        else:
            sx1 = max(0, x1 - int(bw * 0.20))
            sx2 = min(frame_w, x2 + int(bw * 0.20))
            sy1 = max(0, y1 - int(bh * 0.55))
            sy2 = min(frame_h, y1 + int(bh * 0.45))
        if sy2 - sy1 < 28:
            sy2 = min(frame_h, sy1 + 28)
        return sx1, sy1, sx2, sy2

    def find_face(
        self,
        frame: np.ndarray,
        person_bbox: tuple[int, int, int, int],
        *,
        tight: bool = False,
    ) -> FaceHit | None:
        if frame is None or frame.size == 0 or not self._ensure_loaded():
            return None
        assert self._detector is not None

        frame_h, frame_w = frame.shape[:2]
        sx1, sy1, sx2, sy2 = self._search_roi(frame_w, frame_h, person_bbox, tight=tight)
        roi = frame[sy1:sy2, sx1:sx2]
        if roi.size == 0:
            return None

        rh, rw = roi.shape[:2]
        self._detector.setInputSize((rw, rh))
        _, faces = self._detector.detect(roi)
        if faces is None or len(faces) == 0:
            return None

        px1, py1, px2, py2 = person_bbox
        person_cx = (px1 + px2) / 2.0
        pbw = max(24, px2 - px1)
        pbh = max(40, py2 - py1)
        best: FaceHit | None = None
        best_score = -1.0

        for row in faces:
            fx, fy, fw, fh = row[0], row[1], row[2], row[3]
            score = float(row[-1])
            if score < 0.45:
                continue
            fcx = sx1 + fx + fw / 2.0
            fcy = sy1 + fy + fh / 2.0
            candidate = FaceHit(
                cx=fcx,
                cy=fcy,
                bbox=(
                    int(sx1 + fx),
                    int(sy1 + fy),
                    int(sx1 + fx + fw),
                    int(sy1 + fy + fh),
                ),
                confidence=score,
            )
            if not FaceFinder.face_matches_track(candidate, person_bbox):
                continue
            dist = abs(fcx - person_cx) / max(pbw, 1.0)
            head_center_y = py1 + pbh * 0.22
            dist_y = abs(fcy - head_center_y) / max(pbh, 1.0)
            combined = score * fw * fh / (1.0 + dist * 1.5 + dist_y * 2.5)
            if combined > best_score:
                best_score = combined
                best = candidate
        return best

    def scan_faces(self, frame: np.ndarray, *, max_width: int | None = None) -> list[FaceHit]:
        if frame is None or frame.size == 0 or not self._ensure_loaded():
            return []
        assert self._detector is not None

        max_width = SCAN_MAX_WIDTH if max_width is None else max_width
        frame_h, frame_w = frame.shape[:2]
        now = time.time()
        cache = getattr(self, "_scan_cache", None)
        if (
            cache is not None
            and now - cache[0] < SCAN_CACHE_SEC
            and cache[1] == frame_w
            and cache[2] == frame_h
        ):
            return cache[3]

        scale = 1.0
        work = frame
        if frame_w > max_width:
            scale = max_width / float(frame_w)
            work = cv2.resize(
                frame,
                (max_width, max(1, int(round(frame_h * scale)))),
                interpolation=cv2.INTER_AREA,
            )

        rh, rw = work.shape[:2]
        self._detector.setInputSize((rw, rh))
        _, faces = self._detector.detect(work)
        hits: list[FaceHit] = []
        if faces is not None:
            inv = 1.0 / scale
            for row in faces:
                fx, fy, fw, fh = row[0], row[1], row[2], row[3]
                score = float(row[-1])
                if score < 0.45:
                    continue
                hits.append(
                    FaceHit(
                        cx=(fx + fw / 2.0) * inv,
                        cy=(fy + fh / 2.0) * inv,
                        bbox=(
                            int(round(fx * inv)),
                            int(round(fy * inv)),
                            int(round((fx + fw) * inv)),
                            int(round((fy + fh) * inv)),
                        ),
                        confidence=score,
                    )
                )

        self._scan_cache = (now, frame_w, frame_h, hits)
        return hits

    @staticmethod
    def face_matches_track(face: FaceHit, person_bbox: tuple[int, int, int, int]) -> bool:
        x1, y1, x2, y2 = person_bbox
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        fx1, _, fx2, _ = face.bbox
        head_bottom = y1 + bh * 0.32
        if not (y1 - bh * 0.03 <= face.cy <= head_bottom):
            return False
        person_cx = (x1 + x2) / 2.0
        if abs(face.cx - person_cx) > bw * 0.22:
            return False
        overlap_w = min(fx2, x2) - max(fx1, x1)
        face_w = max(1, fx2 - fx1)
        return overlap_w / face_w >= 0.45

    @staticmethod
    def owner_track_id(face: FaceHit, tracks: list) -> int | None:
        best_tid: int | None = None
        best_score = -1.0
        for track in tracks:
            tid = int(getattr(track, "track_id", -1))
            bbox = getattr(track, "bbox", None)
            if bbox is None or not FaceFinder.face_matches_track(face, bbox):
                continue
            score = FaceFinder.head_fit_score(face, bbox)
            if score > best_score:
                best_score = score
                best_tid = tid
        return best_tid

    @staticmethod
    def face_for_track(
        faces: list[FaceHit],
        tracks: list,
        track_id: int,
        *,
        anchor: tuple[float, float] | None = None,
        min_score: float = 0.40,
    ) -> FaceHit | None:
        tid = int(track_id)
        owned = [
            face
            for face in faces
            if face.confidence >= min_score and FaceFinder.owner_track_id(face, tracks) == tid
        ]
        if not owned:
            return None
        if anchor is not None:
            ax, ay = anchor
            return min(owned, key=lambda f: (f.cx - ax) ** 2 + (f.cy - ay) ** 2)
        target = next((t for t in tracks if int(getattr(t, "track_id", -1)) == tid), None)
        if target is None:
            return max(owned, key=lambda f: f.confidence)
        bbox = target.bbox
        return max(owned, key=lambda f: FaceFinder.head_fit_score(f, bbox))

    @staticmethod
    def head_fit_score(face: FaceHit, person_bbox: tuple[int, int, int, int]) -> float:
        x1, y1, x2, y2 = person_bbox
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        expected_cx = (x1 + x2) / 2.0
        expected_cy = y1 + bh * 0.22
        dx = (face.cx - expected_cx) / bw
        dy = (face.cy - expected_cy) / max(bh * 0.5, 1.0)
        return face.confidence / (1.0 + (dx * dx + dy * dy) * 4.0)

    @staticmethod
    def pick_face_for_focus(
        faces: list[FaceHit],
        person_bbox: tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
        *,
        min_score: float = 0.40,
        anchor: tuple[float, float] | None = None,
        strict: bool = False,
    ) -> FaceHit | None:
        qualified = [f for f in faces if f.confidence >= min_score]
        if not qualified:
            return None

        matching = [f for f in qualified if FaceFinder.face_matches_track(f, person_bbox)]

        if strict:
            if not matching:
                return None
            if anchor is not None:
                ax, ay = anchor
                return min(matching, key=lambda f: (f.cx - ax) ** 2 + (f.cy - ay) ** 2)
            return max(matching, key=lambda f: FaceFinder.head_fit_score(f, person_bbox))

        if anchor is not None and matching:
            ax, ay = anchor
            return min(matching, key=lambda f: (f.cx - ax) ** 2 + (f.cy - ay) ** 2)

        for face in qualified:
            if FaceFinder.face_matches_track(face, person_bbox):
                return face

        if anchor is not None:
            ax, ay = anchor
            max_dist = max(frame_w, frame_h) * 0.22
            near = [
                f
                for f in qualified
                if ((f.cx - ax) ** 2 + (f.cy - ay) ** 2) ** 0.5 <= max_dist
            ]
            if near:
                return min(near, key=lambda f: (f.cx - ax) ** 2 + (f.cy - ay) ** 2)

        px1, py1, px2, py2 = person_bbox
        pcx = (px1 + px2) / 2.0
        pcy = (py1 + py2) / 2.0
        max_dist = max(frame_w, frame_h) * 0.55

        best: FaceHit | None = None
        best_score = -1.0
        for face in qualified:
            dist = ((face.cx - pcx) ** 2 + (face.cy - pcy) ** 2) ** 0.5
            if dist > max_dist:
                continue
            fw = max(1, face.bbox[2] - face.bbox[0])
            fh = max(1, face.bbox[3] - face.bbox[1])
            score = face.confidence * fw * fh / (1.0 + dist * 0.01)
            if score > best_score:
                best_score = score
                best = face

        if best is not None:
            return best
        if len(qualified) == 1:
            return qualified[0]
        return max(qualified, key=lambda f: f.confidence)

    @staticmethod
    def estimate_head(person_bbox: tuple[int, int, int, int]) -> FaceHit:
        x1, y1, x2, y2 = person_bbox
        bw = max(24, x2 - x1)
        bh = max(40, y2 - y1)
        cx = (x1 + x2) / 2.0
        cy = y1 + bh * 0.22
        fw = int(max(28, bw * 0.52))
        fh = int(max(28, bh * 0.30))
        fx1 = int(cx - fw / 2)
        fy1 = int(cy - fh * 0.55)
        fy2 = fy1 + fh
        return FaceHit(
            cx=cx,
            cy=cy,
            bbox=(fx1, fy1, fx1 + fw, fy2),
            confidence=0.0,
        )

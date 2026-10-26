from __future__ import annotations

from dataclasses import dataclass

HIGH_CONF = 0.35
LOW_CONF = 0.12
CONFIRM_HITS = 3


@dataclass
class OfflineTrack:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float


@dataclass
class _T:
    tid: int
    box: list[float]
    vel: list[float]
    hits: int = 1
    misses: int = 0
    conf: float = 0.0

    def predicted(self) -> list[float]:
        k = self.misses + 1
        return [self.box[i] + self.vel[i] * k for i in range(4)]


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    return inter / max((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter, 1e-6)


def _affinity(track_box, det_box) -> float:
    iou = _iou(track_box, det_box)
    if iou > 0:
        return iou
    th = track_box[3] - track_box[1]
    dh = det_box[3] - det_box[1]
    if th <= 0 or not (0.6 <= dh / th <= 1.6):
        return 0.0
    dx = (track_box[0] + track_box[2] - det_box[0] - det_box[2]) / 2
    dy = (track_box[1] + track_box[3] - det_box[1] - det_box[3]) / 2
    dist = (dx * dx + dy * dy) ** 0.5
    return max(0.0, 0.25 * (1 - dist / (0.6 * th))) if dist < 0.6 * th else 0.0


class OfflineTracker:
    def __init__(self, *, fps: float, max_lost_seconds: float = 1.0) -> None:
        self.max_misses = max(5, int(fps * max_lost_seconds))
        self.tracks: list[_T] = []
        self._next = 1

    @staticmethod
    def _greedy(tracks: list[_T], dets: list[tuple], min_aff: float):
        pairs = []
        for ti, t in enumerate(tracks):
            pb = t.predicted()
            for di, d in enumerate(dets):
                a = _affinity(pb, d[:4])
                if a >= min_aff:
                    pairs.append((a, ti, di))
        pairs.sort(reverse=True)
        used_t, used_d, matches = set(), set(), []
        for a, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            matches.append((ti, di))
        return matches, used_t, used_d

    def _apply(self, t: _T, det: tuple) -> None:
        new = [float(v) for v in det[:4]]
        k = t.misses + 1
        inst = [(new[i] - t.box[i]) / k for i in range(4)]
        t.vel = [0.6 * t.vel[i] + 0.4 * inst[i] for i in range(4)]
        t.box = new
        t.hits += 1
        t.misses = 0
        t.conf = float(det[4])

    def update(self, detections: list[tuple]) -> list[OfflineTrack]:
        high = [d for d in detections if d[4] >= HIGH_CONF]
        low = [d for d in detections if LOW_CONF <= d[4] < HIGH_CONF]
        updated: set[int] = set()

        matches, used_t, used_h = self._greedy(self.tracks, high, 0.2)
        for ti, di in matches:
            self._apply(self.tracks[ti], high[di])
            updated.add(ti)

        rest = [ti for ti in range(len(self.tracks)) if ti not in used_t]
        m2, _, _ = self._greedy([self.tracks[ti] for ti in rest], low, 0.3)
        for k, di in m2:
            ti = rest[k]
            self._apply(self.tracks[ti], low[di])
            updated.add(ti)

        for ti, t in enumerate(self.tracks):
            if ti not in updated:
                t.misses += 1
        self.tracks = [t for t in self.tracks if t.misses <= self.max_misses]

        for di, d in enumerate(high):
            if di not in used_h:
                self.tracks.append(_T(self._next, [float(v) for v in d[:4]], [0.0] * 4, conf=float(d[4])))
                self._next += 1

        return [
            OfflineTrack(t.tid, tuple(int(v) for v in t.box), t.conf)
            for t in self.tracks
            if t.misses == 0 and t.hits >= CONFIRM_HITS
        ]

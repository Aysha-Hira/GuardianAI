from __future__ import annotations

import threading

import cv2
import numpy as np

from detection import open_webcam


class _BaseReader:
    def __init__(self) -> None:
        self._frame: np.ndarray | None = None
        self._seq = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        raise NotImplementedError

    def _publish(self, frame: np.ndarray) -> None:
        with self._lock:
            self._frame = frame
            self._seq += 1

    def latest(self) -> tuple[np.ndarray | None, int]:
        with self._lock:
            return self._frame, self._seq

    def stop(self) -> None:
        self._stop.set()


class _LiveReader(_BaseReader):
    """RTSP / HTTP (MJPEG) stream. Reconnects after a failure."""

    def __init__(self, url: str) -> None:
        self._url = url
        super().__init__()

    def _open(self) -> cv2.VideoCapture:
        capture = cv2.VideoCapture(
            self._url,
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 3000,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000,
            ],
        )
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return capture

    def _run(self) -> None:
        capture = self._open()
        while not self._stop.is_set():
            frame_read_ok, frame = capture.read() if capture.isOpened() else (False, None)
            if not frame_read_ok or frame is None:
                capture.release()
                if self._stop.wait(2.0):
                    break
                capture = self._open()
                continue
            self._publish(frame)
        capture.release()


class _WebcamReader(_BaseReader):
    """Local webcam. Reconnects after a failure."""

    def __init__(self, device_index: int) -> None:
        self._device_index = device_index
        super().__init__()

    def _run(self) -> None:
        capture = None
        while not self._stop.is_set():
            if capture is None:
                try:
                    capture = open_webcam(self._device_index)
                except Exception:
                    if self._stop.wait(2.0):
                        break
                    continue
            frame_read_ok, frame = capture.read()
            if not frame_read_ok or frame is None:
                capture.release()
                capture = None
                continue
            self._publish(frame)
        if capture is not None:
            capture.release()


def make_reader(source_type: str, url: str | None) -> _BaseReader:
    if source_type == "webcam":
        return _WebcamReader(int(url) if url and url.isdigit() else 0)
    if not url:
        raise ValueError("This camera has no stream URL")
    return _LiveReader(url)

from __future__ import annotations

DEFAULT_LOITERING_THRESHOLD_SECONDS = 15.0
MIN_LOITERING_THRESHOLD_SECONDS = 5.0
MAX_LOITERING_THRESHOLD_SECONDS = 300.0


class AppSettings:

    def __init__(self) -> None:
        self._loitering_threshold_seconds = DEFAULT_LOITERING_THRESHOLD_SECONDS

    @property
    def loitering_threshold_seconds(self) -> float:
        return self._loitering_threshold_seconds

    def set_loitering_threshold(self, seconds: float) -> float:
        value = float(seconds)
        if value < MIN_LOITERING_THRESHOLD_SECONDS or value > MAX_LOITERING_THRESHOLD_SECONDS:
            raise ValueError(
                f"Threshold must be between {int(MIN_LOITERING_THRESHOLD_SECONDS)} "
                f"and {int(MAX_LOITERING_THRESHOLD_SECONDS)} seconds."
            )
        self._loitering_threshold_seconds = value
        return value

    def to_dict(self) -> dict[str, float]:
        return {
            "loitering_threshold_seconds": round(self._loitering_threshold_seconds, 1),
        }


app_settings = AppSettings()

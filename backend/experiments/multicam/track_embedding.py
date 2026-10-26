from __future__ import annotations

import numpy as np

from experiments.multicam.crop_selector import select_track_crops
from experiments.reid.osnet_extractor import OSNetExtractor


def build_track_embedding(
    extractor: OSNetExtractor,
    samples: list[tuple[np.ndarray, float]],
    *,
    min_crops: int = 5,
    max_crops: int = 10,
) -> np.ndarray:
    crops = select_track_crops(samples, min_crops=min_crops, max_crops=max_crops)
    if not crops:
        raise ValueError("No usable crops for track embedding")
    embs = extractor.embed_batch(crops)
    mean = embs.mean(axis=0)
    norm = float(np.linalg.norm(mean))
    if norm <= 0:
        return embs[0]
    return (mean / norm).astype(np.float32)

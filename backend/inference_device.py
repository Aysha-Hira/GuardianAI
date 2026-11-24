from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def resolve_inference_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def torch_device_string() -> str:
    device = resolve_inference_device()
    return "cuda:0" if device == "cuda" else device

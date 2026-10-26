from __future__ import annotations

import os
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from experiments.reid.osnet_arch import osnet_ibn_x1_0, osnet_x0_25, osnet_x1_0

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_DIR = PROJECT_ROOT / "data" / "multicam" / "embeddings"

_HF = "https://huggingface.co/kaiyangzhou/osnet/resolve/main/"
_SUFFIX = "_msmt17_combineall_256x128_amsgrad_ep150_stp60_lr0.0015_b64_fb10_softmax_labelsmooth_flip_jitter.pth"
MODELS = {
    "osnet_ibn_x1_0": (osnet_ibn_x1_0, "osnet_ibn_x1_0_msmt17.pth", _HF + "osnet_ibn_x1_0" + _SUFFIX),
    "osnet_x1_0": (osnet_x1_0, "osnet_x1_0_msmt17.pth", _HF + "osnet_x1_0" + _SUFFIX),
    "osnet_x0_25": (osnet_x0_25, "osnet_x0_25_msmt17.pth", _HF + "osnet_x0_25" + _SUFFIX),
}
DEFAULT_MODEL = os.getenv("MULTICAM_REID_MODEL", "osnet_ibn_x1_0")
FALLBACK_MODEL = "osnet_x0_25"

WEIGHTS_FILE = WEIGHTS_DIR / MODELS[FALLBACK_MODEL][1]

INPUT_H = 256
INPUT_W = 128
EMBEDDING_DIM = 512


def _download(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(".part")
    print(f"Downloading OSNet Re-ID weights -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "GuardianAI/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
        out.write(resp.read())
    tmp.replace(dest)


class OSNetExtractor:

    def __init__(self, device: str | None = None, model_name: str | None = None, *, flip: bool = True) -> None:
        if device is None:
            from inference_device import torch_device_string

            device = torch_device_string()
        self.device = torch.device(device)
        self.model_name = model_name or DEFAULT_MODEL
        if self.model_name not in MODELS:
            self.model_name = FALLBACK_MODEL
        self._model: torch.nn.Module | None = None
        self.flip = flip

    def _load(self, name: str) -> torch.nn.Module:
        builder, filename, url = MODELS[name]
        weights = WEIGHTS_DIR / filename
        if not weights.is_file() or weights.stat().st_size < 1_000_000:
            _download(url, weights)
        model = builder(num_classes=1000, pretrained=False, loss="softmax")
        state = torch.load(weights, map_location="cpu", weights_only=False)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        cleaned = {}
        for k, v in state.items():
            key = k[7:] if k.startswith("module.") else k
            if key.startswith("classifier."):
                continue
            cleaned[key] = v
        missing, _unexpected = model.load_state_dict(cleaned, strict=False)
        if len(missing) > 4:
            raise RuntimeError(f"{name}: {len(missing)} weights missing — wrong checkpoint?")
        model.classifier = torch.nn.Identity()
        model.eval()
        return model

    def _ensure_model(self) -> torch.nn.Module:
        if self._model is not None:
            return self._model
        WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
        try:
            model = self._load(self.model_name)
        except Exception as exc:
            if self.model_name == FALLBACK_MODEL:
                raise
            print(f"[Re-ID] Could not load {self.model_name} ({exc}); falling back to {FALLBACK_MODEL}")
            self.model_name = FALLBACK_MODEL
            model = self._load(FALLBACK_MODEL)
        model.to(self.device)
        self._model = model
        print(f"[Re-ID] Using {self.model_name} on {self.device}")
        return model

    @staticmethod
    def _preprocess(crop_bgr: np.ndarray) -> torch.Tensor:
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (INPUT_W, INPUT_H), interpolation=cv2.INTER_LINEAR)
        arr = rgb.astype(np.float32) / 255.0
        arr = (arr - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array(
            [0.229, 0.224, 0.225], dtype=np.float32
        )
        return torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0)

    @torch.inference_mode()
    def _forward(self, batch: torch.Tensor) -> torch.Tensor:
        model = self._ensure_model()
        batch = batch.to(self.device)
        feat = model(batch)
        if isinstance(feat, (tuple, list)):
            feat = feat[0]
        if not self.flip:
            return F.normalize(feat, p=2, dim=1)
        feat_flip = model(torch.flip(batch, dims=[3]))
        if isinstance(feat_flip, (tuple, list)):
            feat_flip = feat_flip[0]
        return F.normalize(feat + feat_flip, p=2, dim=1)

    def embed(self, crop_bgr: np.ndarray) -> np.ndarray:
        return self.embed_batch([crop_bgr])[0]

    def embed_batch(self, crops_bgr: list[np.ndarray]) -> np.ndarray:
        if not crops_bgr:
            return np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
        out = []
        for i in range(0, len(crops_bgr), 64):
            batch = torch.cat([self._preprocess(c) for c in crops_bgr[i : i + 64]], dim=0)
            out.append(self._forward(batch).cpu().numpy().astype(np.float32))
        return np.concatenate(out, axis=0)

    @property
    def embedding_dim(self) -> int:
        return EMBEDDING_DIM

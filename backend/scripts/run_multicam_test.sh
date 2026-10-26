#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f data/multicam/raw/camera_01/video.mp4 ]]; then
  echo "Dataset missing — downloading CITIC-MTMC hall subset …"
  python scripts/download_multicam_dataset.py
fi

python experiments/multicam_reid.py \
  --threshold 0.42 \
  --sequential \
  "$@"

echo ""
echo "Watch: outputs/multicam/sequential_annotated.mp4  (cam 1, then cam 2)"
echo "Also:  outputs/multicam/camera_01_annotated.mp4"
echo "       outputs/multicam/camera_02_annotated.mp4"
echo "       outputs/multicam/transitions.json"

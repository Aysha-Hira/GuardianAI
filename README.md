# Guardian AI

AI-powered CCTV monitoring: live person detection and tracking, restricted zones and loitering,
behaviour-anomaly detection, watchlist face recognition, multi-camera person re-identification,
incident management with severity scoring, analytics and exportable reports.

**Stack:** FastAPI · SQLAlchemy · PostgreSQL · Angular 20 · YOLO11 · DeepSORT · OSNet · DeepFace (ArcFace) · PyTorch · scikit-learn

---

## Team and ownership

| Area | Owner | Files and folders |
|------|-------|-------------------|
| **Frontend & database** | Person 1 — _name_ | `frontend-angular/` · table definitions: `auth/database.py`, `auth/models.py`, `alerts/db.py`, `subscriptions/db.py`, `watchlist/db.py` · `scripts/setup_postgres.sh`, `scripts/migrate_to_postgres.py`, `scripts/test_postgres_storage.py` |
| **Backend** | Person 2 — _name_ | `main.py`, `camera_service.py`, `settings.py` · `auth/` (sign-in, cookies + CSRF, two-step email codes, rate limiting, emails) · `subscriptions/` (plans, checkout) · `alerts/` (incident store and workflow) · `watchlist/` (encrypted storage, API) · `recording/` · `zones/` + `zone_configs/` · `cameras/` · `templates/`, `static/` · run/setup scripts |
| **Machine learning** | Person 3 — _name_ | `ml/` (training) · `behavior/` (ConvLSTM anomaly) · `alerts/severity.py`, `alerts/severity_service.py`, `alerts/features.py` (Random Forest severity) · `recognition/` + `watchlist/weights.py` (face recognition) · `tracking/` (DeepSORT + live Re-ID) · `experiments/` (multi-camera Re-ID) · `focus/` · `models/` · `data/` |
| **Detection (YOLO)** | _name_ | `detection.py`, `frame_processor.py`, `inference_device.py`, `app.py`, `scripts/benchmark_yolo_cameras.py`, `scripts/profile_server.py` |

How the parts connect: the **frontend** calls the **backend** API (`/api/*`); the backend runs the camera
pipeline and calls the **ML** modules through plain functions (severity scoring, face matching,
Re-ID embeddings, anomaly scores); everything persistent goes through the **database** layer.

---

## Project structure

```
main.py                FastAPI app and API routes
camera_service.py      Live camera pipeline (detection → tracking → zones → alerts)
detection.py           YOLO person detection
auth/                  Accounts, cookie sessions, CSRF, two-step sign-in, emails
subscriptions/         Free / Professional / Enterprise plans, checkout
alerts/                Incidents and severity scoring
zones/                 Restricted zones and loitering
recording/             Incident clips
cameras/               Multi-channel camera wall
watchlist/             Encrypted watchlist storage
recognition/           Face recognition (DeepFace / ArcFace)
tracking/              Multi-object tracking + live Re-ID
behavior/  ml/         Behaviour anomaly model and training scripts
experiments/           Offline multi-camera Re-ID (OSNet)
focus/                 Auto-zoom on incidents
models/                Trained ConvLSTM and severity models
frontend-angular/      Web app (Angular)
scripts/               Setup, migration, dataset and test scripts
data/                  Dataset notes (datasets themselves are not in the repo)
```

---

## Running it

**Requirements:** Python 3.12 (3.9–3.13 work), Node.js 20+, PostgreSQL (optional — falls back to SQLite).

### macOS / Linux

```bash
# 1. Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then fill in the values
bash scripts/setup_postgres.sh    # optional: creates the database and fills .env
python main.py                    # http://127.0.0.1:8000

# 2. Frontend (second terminal)
cd frontend-angular
npm install
npm start                         # http://localhost:4200
```

### Windows

Double-click `setup-windows.bat` once, then `run-windows.bat`.

### Face recognition (optional)

DeepFace runs in its own virtual environment so TensorFlow doesn't clash with PyTorch:

```bash
python3 -m venv .venv-deepface
.venv-deepface/bin/pip install deepface tf-keras tensorflow opencv-python numpy
.venv/bin/python scripts/setup_deepface_weights.py
```

### Test account (development only)

`operator@guardian.ai` / `Guardian1!` is created automatically in development.
It is never created when `GUARDIAN_ENV=production` (unless `GUARDIAN_SEED_TEST_USER=1`).

---

## What is not in this repository

| Not included | How to get it |
|--------------|---------------|
| `.env` (secrets) | Copy `.env.example` and fill it in. Never commit `.env`. |
| YOLO weights (`yolo11n.pt`, `yolo11s.pt`) | Downloaded automatically by Ultralytics on first run |
| DeepFace weights | `scripts/setup_deepface_weights.py` — see `data/watchlist/README.md` |
| OSNet Re-ID weights | Downloaded on first multi-camera run |
| Test CCTV videos | `scripts/download_test_cctv.py` |
| Multi-camera dataset (CITIC-MTMC) | `scripts/download_multicam_dataset.py` — see `data/multicam/README.md`. Licensed **CC BY-NC-SA 4.0**, so it is not redistributed here. |
| Watchlist photos, uploads, recordings, incident snapshots | Created at runtime; private data |

---

Capstone project — for academic use.

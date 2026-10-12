# GuardianAI

AI-powered surveillance system that detects and tracks people in video using YOLO11 and DeepSORT.

## Features

- Person detection with YOLO11
- Multi-object tracking with DeepSORT
- Checkpointing for long-running video processing

## Project Structure

```
GuardianAI/
├── ai/                # Detection and tracking pipeline
├── .env.example       # Template for required environment variables
├── .gitignore
├── requirements.txt
└── README.md
```

## Setup

**Requirements:** Python 3.10+ (check with `python --version`), Git, and optionally an NVIDIA GPU with CUDA for faster inference.

### 1. Clone the repo

```bash
git clone https://github.com/Aysha-Hira/GuardianAI.git
cd GuardianAI
```

### 2. Create and activate a virtual environment

**Windows (PowerShell)**

```powershell
python -m venv virtual_environment
virtual_environment\Scripts\Activate.ps1
```

If activation is blocked, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**Windows (cmd)**

```cmd
python -m venv virtual_environment
virtual_environment\Scripts\activate.bat
```

**macOS / Linux**

```bash
python3 -m venv virtual_environment
source virtual_environment/bin/activate
```

Your prompt should now start with `(virtual_environment)`.

### 3. Install dependencies

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

For GPU support, install the matching PyTorch build first using the command from [pytorch.org](https://pytorch.org/get-started/locally/). A plain `pip install torch` may give a CPU-only build.

### 4. Configure environment variables

**Windows:** `copy .env.example .env`
**macOS / Linux:** `cp .env.example .env`

Then fill in the values in `.env`.

### 5. Deactivate when done

```bash
deactivate
```

## Configuration

| Variable     | Description      | Example     |
| ------------ | ---------------- | ----------- |
| `<VAR_NAME>` | `<what it does>` | `<example>` |

## Usage

```bash
python ai/<your_script>.py --source <video_path_or_stream>
```

`<Describe output location, e.g. annotated video in outputs/, checkpoints in checkpoints/>`

## Roadmap

- [x] YOLO11 + DeepSORT tracker
- [ ] Behavior / anomaly classification
- [ ] Backend and frontend integration

## Team

- Supervisor: `Modafar Ati`
- Course: ITE499A, Abu Dhabi University

## License

`<License, or "All rights reserved" for a private project>`

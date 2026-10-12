from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort
from dotenv import load_dotenv
import cv2
import json
import os
import datetime

load_dotenv()

VIDEO = os.getenv("VIDEO_PATH")
CHECKPOINT_FILE = os.getenv("CHECKPOINT_FILE")
OBJECTS_TO_TRACK = ["person"]
MODEL_VARIANTS = [
    "yolo11s.pt", "yolo11m.pt", "yolo11l.pt", "yolo11x.pt",
    # "yolo26n.pt", "yolo26s.pt", "yolo26m.pt", "yolo26l.pt", "yolo26x.pt",

]

MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

# I used .md so its easier to view when using obosidian or notion.
EXPERIMENTS_FILE = "experiments.md"

# YOLO
CONFIDENCE_VALUE_YOLO = 0.45

# DeepSORT
MAX_AGE = 50


# Make a table so its easier to add the results after viewing each output videos and after each run


def write_experiment_results(day, time, weight_name):
    # First check if file (experiment_results) exists, if not create it
    if not os.path.exists(EXPERIMENTS_FILE):
        with open(EXPERIMENTS_FILE, 'w') as file:
            file.write(
                "| Experiment Number | Day-Time | YOLO-Model | Confidence Level (YOLO)| DeepSort Parameters | Results |\n")
            file.write("|---|---|---|---|---|---|\n")

    with open(EXPERIMENTS_FILE, 'a') as file:
        # TODO: Make sure Deepsort parameters are added after each run if parameterss are modified.
        file.write(
            f"| TBF  |{day}-{time} | {weight_name.replace('.pt', '')} | {CONFIDENCE_VALUE_YOLO} | max_age={MAX_AGE} | Tracking: <br> ID tracking Stability: <br> Additional Notes: <br> |\n")

# Create a VideoWriter matching the input video's properties


def setup_writer(cap, weight_name):
    fps = cap.get(cv2.CAP_PROP_FPS)
    output_video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    time = datetime.datetime.now().strftime("%H%M%S")
    day = datetime.datetime.now().strftime("%Y%m%d")

    if not os.path.exists(f"videos/results/{day}"):
        os.mkdir(f"videos/results/{day}")

    write_experiment_results(day, time, weight_name)

    return cv2.VideoWriter(
        f"videos/results/{day}/output_{weight_name.replace('.pt', '_')}_{day}_{time}.mp4",
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (output_video_width, h),
    )

# Convert YOLO results into DeepSort's expected detection format


def get_detections(results, model):
    detections = []
    for box in results.boxes:
        cls = int(box.cls[0])
        conf = round(float(box.conf[0]), 2)
        if model.names[cls] not in OBJECTS_TO_TRACK or conf < CONFIDENCE_VALUE_YOLO:
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        w, h = x2 - x1, y2 - y1
        detections.append(([x1, y1, w, h], conf, model.names[cls]))
    return detections

# Draw confirmed tracks onto the frame in-place


def draw_tracks(frame, tracks):
    for track in tracks:
        if not track.is_confirmed():
            continue
        l, t, r, b = track.to_ltrb()
        cv2.rectangle(frame, (int(l), int(t)),
                      (int(r), int(b)), (0, 255, 0), 2)
        cv2.putText(
            frame,
            f"ID {track.track_id}",
            (int(l), int(t) - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )

# Run detection + tracking over every frame, writing output.


def process_video(model, tracker, cap, out):
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        results = model(frame, verbose=False)[0]
        detections = get_detections(results, model)
        tracks = tracker.update_tracks(detections, frame=frame)
        draw_tracks(frame, tracks)
        out.write(frame)

# Set up model/tracker/video for one weight and process it.


def run_variant(weight_name):
    print(f"\n=== Predicting with {weight_name.replace('.pt', '')} ===")
    model_folder_path = os.path.join(MODELS_DIR, weight_name)
    model = YOLO(model_folder_path)
    tracker = DeepSort(max_age=MAX_AGE)
    cap = cv2.VideoCapture(VIDEO)

    if not cap.isOpened():
        print(f"Could not open video: {VIDEO}")
        exit()

    out = setup_writer(cap, weight_name)

    if not out.isOpened():
        cap.release()
        print("Could not create output video.")
        exit()

    try:
        process_video(model, tracker, cap, out)

    finally:
        cap.release()
        out.release()


# Loads a checkpoint to continue
def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        if os.path.getsize(CHECKPOINT_FILE) == 0:
            return {"completed": []}

        with open(CHECKPOINT_FILE, "r") as f:
            return json.load(f)
    else:
        with open(CHECKPOINT_FILE, "w") as file:
            json.dump({"completed": []}, file)
            return {"completed": []}


def save_checkpoint(state):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(state, f)


def main():
    if not VIDEO or not CHECKPOINT_FILE:
        print("VIDEO_PATH or CHECKPOINT_FILE not set in .env file.")
        exit()

    state = load_checkpoint()
    for weight_name in MODEL_VARIANTS:
        if weight_name in state["completed"]:
            print(f"Skipping {weight_name.replace('.pt', '')}, already done")
            continue
        run_variant(weight_name)
        state["completed"].append(weight_name)
        save_checkpoint(state)
        print("Completed!")


if __name__ == "__main__":
    main()

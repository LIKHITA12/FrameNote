import shutil
from pathlib import Path

from fastapi import HTTPException

from app.core.config import settings
from app.services.storage import build_object_key

# backend/app/services/local_pipeline.py -> parents[2] is the backend/ project root.
BACKEND_ROOT = Path(__file__).resolve().parents[2]
LOCAL_INPUT_DIR = BACKEND_ROOT / "input"
LOCAL_OUTPUT_DIR = BACKEND_ROOT / "output"


def resolve_local_input_file(file_name: str) -> Path:
    safe_name = Path(file_name).name
    if not safe_name or safe_name != file_name:
        raise HTTPException(status_code=400, detail="Invalid file_name")

    path = LOCAL_INPUT_DIR / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"'{safe_name}' not found in backend/input/")
    return path


def stage_local_input_as_upload(file_name: str, user_id: str) -> str:
    source_path = resolve_local_input_file(file_name)
    object_key = build_object_key(file_name, user_id)
    destination = Path(settings.local_upload_dir) / object_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, destination)
    return object_key


def export_pdf_to_local_output(pdf_path: Path, job_id: str) -> Path:
    LOCAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = LOCAL_OUTPUT_DIR / f"{job_id}.pdf"
    shutil.copyfile(pdf_path, destination)
    return destination

import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_bearer_only, get_db
from app.models.user import User
from app.schemas.jobs import (
    JobCreateRequest,
    JobCreateResponse,
    LocalPipelineRequest,
    PipelineProgress,
    PipelineStatusResponse,
)
from app.services.dispatch import enqueue_job_task
from app.services.jobs import (
    build_pdf_url,
    create_job_record,
    get_latest_pipeline_run,
    reset_pipeline_run_state,
    to_job_response,
)
from app.services.local_pipeline import stage_local_input_as_upload
from app.core.config import settings
from tasks.worker import run_local_test_pipeline, run_summary_pdf_pipeline, run_video_processing_pipeline

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])

_JOB_STATUS_TO_PIPELINE_STATUS = {
    "queued": "running",
    "processing": "running",
    "completed": "completed",
    "failed": "failed",
}


@router.post(
    "/process-and-export-pdf",
    response_model=JobCreateResponse,
    summary="Run background video pipeline and export PDF",
    description=(
        "Creates a job and hands it off to a background worker that transcribes/analyzes the "
        "source and, once processing finishes, renders the final PDF report to its destination "
        "asset path. Returns immediately with the queued job; poll GET /jobs/{job_id} for status "
        "and the resulting pdf_url."
    ),
)
def process_and_export_pdf(
    payload: JobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> JobCreateResponse:
    job = create_job_record(db=db, payload=payload, owner=current_user, is_pipeline_run=True)
    enqueue_job_task(run_video_processing_pipeline, (job.id,), background_tasks, db, job)
    return to_job_response(job)


@router.post(
    "/process-and-export-summary-pdf",
    response_model=JobCreateResponse,
    summary="Run background video pipeline and export a summary-only PDF",
    description=(
        "Same as /process-and-export-pdf but produces the short report: only the overall summary "
        "and its key points with one frame each. It skips the detailed timeline, the questions "
        "and answers and the participant detection, so it is faster and cheaper. Returns "
        "immediately with the queued job; poll GET /jobs/{job_id} for status and the pdf_url."
    ),
)
def process_and_export_summary_pdf(
    payload: JobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> JobCreateResponse:
    job = create_job_record(db=db, payload=payload, owner=current_user, is_pipeline_run=True)
    enqueue_job_task(run_summary_pdf_pipeline, (job.id,), background_tasks, db, job)
    return to_job_response(job)


@router.post(
    "/process-local-file",
    response_model=JobCreateResponse,
    summary="Run pipeline on a local input file (dev/testing)",
    description=(
        "Reads a file already placed in backend/input/<file_name>, stages it like a normal "
        "upload, and hands it to the same background pipeline. Once processing finishes, the "
        "rendered PDF is also copied to backend/output/<job_id>.pdf for quick local inspection, "
        "in addition to the usual pdf_url asset. Intended for local development/testing only."
    ),
)
def process_local_file(
    payload: LocalPipelineRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> JobCreateResponse:
    if settings.environment != "development":
        raise HTTPException(status_code=404, detail="Not found")
    upload_object_key = stage_local_input_as_upload(payload.file_name, current_user.id)
    job_payload = JobCreateRequest(
        source_type="upload", file_name=payload.file_name, upload_object_key=upload_object_key
    )
    job = create_job_record(db=db, payload=job_payload, owner=current_user, is_pipeline_run=True)
    enqueue_job_task(run_local_test_pipeline, (job.id,), background_tasks, db, job)
    return to_job_response(job)


@router.get(
    "/status",
    response_model=PipelineStatusResponse,
    summary="Get background pipeline run status",
    description=(
        "Returns the current state of the last (or active) pipeline run.\n\n"
        "**status values:**\n\n"
        "- `idle` — no run triggered yet\n"
        "- `running` — pipeline is executing (watch terminal for file-level logs)\n"
        "- `completed` — finished successfully (check `progress` for counts)\n"
        "- `failed` — a fatal error stopped the pipeline (see `error` field)"
    ),
)
def get_pipeline_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> PipelineStatusResponse:
    job = get_latest_pipeline_run(db=db, owner_id=current_user.id)
    if not job:
        return PipelineStatusResponse(status="idle")

    key_points = json.loads(job.key_points_json or "[]")
    return PipelineStatusResponse(
        status=_JOB_STATUS_TO_PIPELINE_STATUS.get(job.status, "failed"),
        job_id=job.id,
        source_type=job.source_type,
        source_url=job.source_url,
        file_name=job.file_name,
        progress=PipelineProgress(key_points_extracted=len(key_points), pdf_generated=bool(job.pdf_asset_key)),
        pdf_url=build_pdf_url(job),
        error=job.error_message,
    )


@router.post(
    "/reset",
    response_model=PipelineStatusResponse,
    summary="Force-reset pipeline state to idle",
    description=(
        "Force-resets the pipeline state back to idle. Un-flags all of the caller's past pipeline "
        "runs so GET /pipeline/status reports `idle` again. Does not cancel an in-flight background "
        "worker task, it only stops surfacing its status here."
    ),
)
def reset_pipeline_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> PipelineStatusResponse:
    reset_pipeline_run_state(db=db, owner_id=current_user.id)
    return PipelineStatusResponse(status="idle")

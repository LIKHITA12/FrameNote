"""Endpoints for turning a public video link into notes and a PDF.

The upload flow needs the file itself (POST /uploads/presign, then POST /jobs). These two
endpoints take only a URL. The work runs in the background, exactly like the upload flow,
so the caller gets a job id back immediately and polls GET /jobs/{job_id} for
`status`, `processing_stage` and the finished `pdf_url`.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.jobs import (
    JobCreateRequest,
    JobCreateResponse,
    PublicVideoPreviewResponse,
    PublicVideoUrlRequest,
)
from app.services.dispatch import enqueue_job_task
from app.services.auth import get_user_subscription
from app.services.jobs import create_job_record, to_job_response
from app.services.pipeline import extract_youtube_video_id
from app.services.video_url import (
    PublicVideoUrlError,
    probe_public_video,
    validate_public_video_url,
)
from tasks.worker import process_public_video_url

router = APIRouter(prefix="/videos", tags=["Public video links"])


@router.post(
    "/from-url",
    response_model=JobCreateResponse,
    summary="Create notes and a PDF from a public video link",
    description=(
        "Accepts any public video link - a YouTube/Vimeo/Loom video page, or a direct link to a "
        "video or audio file - and starts the same background pipeline the upload flow uses.\n\n"
        "Only the audio is ever fetched, and for YouTube the published captions are used when "
        "they exist, so no media is downloaded at all. No video frames are extracted, and the "
        "generated PDF contains no screenshots from the source video.\n\n"
        "Returns the queued job immediately; poll `GET /jobs/{job_id}` until `status` is "
        "`completed` and read `pdf_url` from the response."
    ),
)
def create_job_from_url(
    payload: PublicVideoUrlRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    try:
        clean_url = validate_public_video_url(payload.url)
    except PublicVideoUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # YouTube links keep source_type="youtube" so the existing embedded player and video id
    # still work; every other link is stored as the generic "url" source.
    youtube_video_id = extract_youtube_video_id(clean_url)
    job = create_job_record(
        db=db,
        payload=JobCreateRequest(
            source_type="youtube" if youtube_video_id else "url",
            source_url=clean_url,
        ),
        owner=current_user,
    )
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    # Report depth is a plan entitlement: Free always receives the compact summary
    # and an active Pro subscription always receives the full detailed report.
    detailed = subscription.tier.lower() == "pro" and subscription.status.lower() == "active"

    enqueue_job_task(process_public_video_url, (job.id, detailed), background_tasks, db, job)

    return to_job_response(job)


@router.post(
    "/from-url/preview",
    response_model=PublicVideoPreviewResponse,
    summary="Resolve a public video link without processing it",
    description=(
        "Checks that a link is a reachable public video and reads its title and duration, "
        "without transcribing anything or creating a job. Useful for confirming a pasted link "
        "before committing to a run. Returns 400 with the reason when the link is unusable."
    ),
)
def preview_public_video_url(
    payload: PublicVideoUrlRequest,
    current_user: User = Depends(get_current_user),
) -> PublicVideoPreviewResponse:
    try:
        source = probe_public_video(payload.url)
    except PublicVideoUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PublicVideoPreviewResponse(
        url=source.url,
        provider=source.provider,
        title=source.title,
        duration_seconds=source.duration_seconds,
        is_youtube=source.is_youtube,
        youtube_video_id=source.youtube_video_id,
    )

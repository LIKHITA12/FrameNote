import json
import mimetypes
import re
from pathlib import Path

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_bearer_only, get_db
from app.models.user import User
from app.models.job import Job
from app.models.job_collaborator import JobCollaborator
from app.models.job_clip import JobClip
from app.models.project import Project
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    SignupRequest,
    TokenResponse,
)
from app.schemas.jobs import (
    ActionItemCompletionRequest,
    BillingCheckoutResponse,
    CustomActionItemRequest,
    HistoryListResponse,
    JobCreateRequest,
    JobCreateResponse,
    JobNotesUpdateRequest,
    JobClipRequest,
    JobClipResponse,
    ProjectRequest,
    ProjectResponse,
    JobProjectRequest,
    ShareRequest,
    CollaboratorResponse,
    PdfGenerateResponse,
    UploadPresignRequest,
    UploadPresignResponse,
    UserProfileResponse,
)
from app.schemas.feedback import (
    FeedbackCreateRequest,
    FeedbackCreateResponse,
    FeedbackListResponse,
    FeedbackMetaResponse,
)
from app.schemas.plans import CheckoutSessionRequest, PricingCatalogResponse
from app.schemas.settings import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    UsageSummaryResponse,
    UserSettingsResponse,
    UserSettingsUpdateRequest,
)
from app.schemas.notifications import NotificationListResponse
from app.schemas.support import (
    ContactMessageRequest,
    ContactMessageResponse,
    SupportMetaResponse,
)
from app.services.dispatch import enqueue_job_task
from app.services.auth import (
    AuthTokenError,
    authenticate_user,
    confirm_password_reset,
    create_access_token,
    get_user_subscription,
    request_password_reset,
    signup_user,
)
from app.services.billing import create_checkout_url, handle_webhook_event
from app.services.feedback import (
    COMMUNITY_PAGE_SIZE,
    build_feedback_meta,
    create_feedback,
    list_public_feedback,
)
from app.services.jobs import (
    add_custom_action_item,
    create_job_record,
    get_accessible_job_or_404,
    get_job_analysis,
    get_job_or_404,
    list_jobs_for_owner,
    prepare_job_retry,
    set_action_item_completed,
    set_job_pdf_asset_key,
    to_job_response,
)
from app.services.notifications import build_notification_feed, mark_notifications_read
from app.services.history import DATE_RANGES, SORT_OPTIONS, list_history
from app.services.pdf import generate_job_pdf, generate_job_summary_pdf
from app.services.plans import build_pricing_catalog
from app.services.support import build_support_meta, create_support_message
from app.services.usage import build_usage_summary, ensure_job_creation_allowed
from app.services.usage import job_duration_seconds
from app.services.user_settings import (
    change_password,
    delete_account,
    get_or_create_settings,
    to_settings_response,
    update_settings,
)
from app.services.storage import (
    build_object_key,
    create_upload_presign,
    resolve_processed_asset_path,
    presigned_upload_download_url,
    resolve_uploaded_object_path,
    save_mock_upload,
)
from app.services.media_access import asset_belongs_to_job, decode_asset_token, verify_upload_token
from app.core.config import settings
from app.services.rate_limit import check_rate_limit, request_ip
from tasks.worker import process_job, process_public_video_url

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _token_response(user: User, db: Session) -> TokenResponse:
    subscription = get_user_subscription(db=db, user_id=user.id)
    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserProfileResponse(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            tier=subscription.tier,
            subscription_status=subscription.status,
        ),
    )


@router.post("/auth/signup", response_model=TokenResponse)
def signup(payload: SignupRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    check_rate_limit("signup-ip", request_ip(request), 5, 3600)
    if settings.environment == "production" and payload.email.strip().lower() == "demo@framenote.local":
        raise HTTPException(status_code=400, detail="This email is unavailable")
    try:
        user = signup_user(db=db, email=payload.email, password=payload.password, full_name=payload.full_name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _token_response(user=user, db=db)


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    check_rate_limit("login-ip", request_ip(request), 30, 900)
    check_rate_limit("login-account", payload.email.strip().lower(), 10, 900)
    user = authenticate_user(db=db, email=payload.email, password=payload.password)
    if not user or (settings.environment == "production" and user.email == "demo@framenote.local"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _token_response(user=user, db=db)


@router.post("/auth/forgot-password", response_model=MessageResponse)
def forgot_password(payload: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)) -> MessageResponse:
    check_rate_limit("password-forgot-ip", request_ip(request), 5, 3600)
    if settings.environment == "production":
        raise HTTPException(status_code=503, detail="Password reset email is not configured")
    token = request_password_reset(db=db, email=payload.email)
    if token:
        # No email provider configured yet: log the reset token so it's usable in local dev.
        print(f"[password-reset] token for {payload.email}: {token}")
    # Always return the same message so we don't leak which emails are registered.
    return MessageResponse(message="If that email is registered, a reset link has been sent.")


@router.post("/auth/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)) -> MessageResponse:
    check_rate_limit("password-reset-ip", request_ip(request), 10, 3600)
    try:
        confirm_password_reset(db=db, token=payload.token, new_password=payload.new_password)
    except AuthTokenError as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token") from exc
    return MessageResponse(message="Password updated. You can now log in.")


@router.get("/users/me", response_model=UserProfileResponse)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserProfileResponse:
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    return UserProfileResponse(
        user_id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        tier=subscription.tier,
        subscription_status=subscription.status,
    )


@router.patch("/users/me/settings", response_model=UserSettingsResponse)
@router.put("/users/me/settings", response_model=UserSettingsResponse)
def update_my_settings(
    payload: UserSettingsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserSettingsResponse:
    settings_row = update_settings(db=db, user=current_user, payload=payload)
    db.refresh(current_user)
    return to_settings_response(user=current_user, settings_row=settings_row)


@router.get("/users/me/settings", response_model=UserSettingsResponse)
def get_my_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserSettingsResponse:
    settings_row = get_or_create_settings(db=db, user=current_user)
    return to_settings_response(user=current_user, settings_row=settings_row)


@router.post("/users/me/change-password", response_model=MessageResponse)
def change_my_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    change_password(
        db=db,
        user=current_user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    return MessageResponse(message="Password updated.")


@router.delete("/users/me", response_model=MessageResponse)
def delete_my_account(
    payload: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    if payload.confirmation.strip().lower() != current_user.email.lower():
        raise HTTPException(status_code=400, detail="Type your email address exactly to confirm deletion.")
    delete_account(db=db, user=current_user)
    return MessageResponse(message="Account deleted.")


@router.get("/users/me/usage", response_model=UsageSummaryResponse)
def get_my_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UsageSummaryResponse:
    return build_usage_summary(db=db, user=current_user)


@router.get("/users/me/notifications", response_model=NotificationListResponse)
def get_my_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    return build_notification_feed(db=db, user=current_user)


@router.post("/users/me/notifications/read", response_model=NotificationListResponse)
def mark_my_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    return mark_notifications_read(db=db, user=current_user)


@router.get("/history", response_model=HistoryListResponse)
def get_history(
    search: str | None = None,
    sources: list[str] | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    date_range: str = "all",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "newest",
    limit: int = 10,
    offset: int = 0,
    project_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HistoryListResponse:
    if sort not in SORT_OPTIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported sort: {sort}")
    if date_range not in DATE_RANGES:
        raise HTTPException(status_code=422, detail=f"Unsupported date_range: {date_range}")

    return list_history(
        db=db,
        owner_id=current_user.id,
        search=search,
        sources=sources,
        tags=tags,
        date_range=date_range,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
        limit=max(1, min(limit, 50)),
        offset=max(0, offset),
        project_id=project_id,
    )


def _project_response(db: Session, project: Project) -> ProjectResponse:
    count = db.scalar(select(func.count(Job.id)).where(Job.project_id == project.id)) or 0
    return ProjectResponse(project_id=project.id, name=project.name, job_count=count)


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[ProjectResponse]:
    projects = db.scalars(select(Project).where(Project.owner_id == current_user.id).order_by(Project.name)).all()
    return [_project_response(db, project) for project in projects]


@router.post("/projects", response_model=ProjectResponse, status_code=201)
def create_project(payload: ProjectRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> ProjectResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Project name is required")
    project = Project(owner_id=current_user.id, name=name)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_response(db, project)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def rename_project(project_id: str, payload: ProjectRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> ProjectResponse:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Project name is required")
    project.name = name
    db.commit()
    return _project_response(db, project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Response:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    for job in db.scalars(select(Job).where(Job.project_id == project.id)).all():
        job.project_id = None
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.get("/support/meta", response_model=SupportMetaResponse)
def get_support_meta(current_user: User = Depends(get_current_user)) -> SupportMetaResponse:
    return build_support_meta(user=current_user)


@router.post("/support/contact", response_model=ContactMessageResponse)
def submit_contact_message(
    payload: ContactMessageRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContactMessageResponse:
    check_rate_limit("support-user", current_user.id, 10, 3600)
    check_rate_limit("support-ip", request_ip(request), 30, 3600)
    record = create_support_message(db=db, user=current_user, payload=payload)
    return ContactMessageResponse(
        message_id=record.id,
        email=record.email,
        message="Message sent successfully! A member of our team will reach out shortly.",
    )


@router.get("/feedback/meta", response_model=FeedbackMetaResponse)
def get_feedback_meta(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedbackMetaResponse:
    """What the Settings > Feedback tab needs on load: the star wording and the shared list."""
    return build_feedback_meta(db=db, user=current_user)


@router.get("/feedback/community", response_model=FeedbackListResponse)
def list_community_feedback(
    limit: int = COMMUNITY_PAGE_SIZE,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedbackListResponse:
    """Ratings and comments from all users, newest first. Backs the tab's "Show more"."""
    return list_public_feedback(db=db, viewer=current_user, limit=limit, offset=offset)


@router.post("/feedback", response_model=FeedbackCreateResponse)
def submit_feedback(
    payload: FeedbackCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedbackCreateResponse:
    record = create_feedback(db=db, user=current_user, payload=payload)
    return FeedbackCreateResponse(
        feedback_id=record.id,
        message="Thanks! Your rating is now part of the list below.",
    )


@router.get("/billing/plans", response_model=PricingCatalogResponse)
def get_billing_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PricingCatalogResponse:
    return build_pricing_catalog(db=db, user=current_user)


@router.post("/jobs", response_model=JobCreateResponse)
def create_job(
    payload: JobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = create_job_record(db=db, payload=payload, owner=current_user)
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    detailed = subscription.tier.lower() == "pro" and subscription.status.lower() == "active"
    enqueue_job_task(process_job, (job.id, detailed), background_tasks, db, job)

    return to_job_response(job)


@router.get("/jobs", response_model=list[JobCreateResponse])
def list_jobs(
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[JobCreateResponse]:
    jobs = list_jobs_for_owner(db=db, owner_id=current_user.id, limit=max(1, min(limit, 100)))
    return [to_job_response(job, viewer_id=current_user.id) for job in jobs]


@router.get("/jobs/{job_id}", response_model=JobCreateResponse)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_accessible_job_or_404(db=db, job_id=job_id, user_id=current_user.id)
    return to_job_response(job, viewer_id=current_user.id)


@router.patch("/jobs/{job_id}", response_model=JobCreateResponse)
def update_job_notes(
    job_id: str,
    payload: JobNotesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    if job.status != "completed":
        raise HTTPException(status_code=409, detail="Only completed notes can be edited")
    if payload.summary is None and payload.decisions is None and payload.action_items is None:
        raise HTTPException(status_code=422, detail="Provide at least one notes field")

    analysis = get_job_analysis(job) or {}
    if payload.summary is not None:
        summary = payload.summary.strip()
        if not summary:
            raise HTTPException(status_code=422, detail="Summary cannot be empty")
        job.summary = summary
        analysis["overview"] = summary
    for field in ("decisions", "action_items"):
        raw_items = getattr(payload, field)
        if raw_items is None:
            continue
        cleaned = [item.strip() for item in raw_items]
        if any(not item or len(item) > 500 for item in cleaned):
            raise HTTPException(status_code=422, detail=f"{field} entries must be 1–500 characters")
        analysis[field] = cleaned
        if field == "action_items":
            existing_details = analysis.get("action_item_details") or []
            analysis["action_item_details"] = [entry for entry in existing_details if isinstance(entry, dict) and entry.get("title") in cleaned]
            job.custom_action_items_json = "[]"
            job.completed_action_items_json = "[]"
    job.analysis_json = json.dumps(analysis)
    # A previously generated PDF contains the old text. The next export must regenerate it.
    job.pdf_asset_key = None
    db.commit()
    db.refresh(job)
    return to_job_response(job)


def _clip_response(clip: JobClip) -> JobClipResponse:
    return JobClipResponse(
        clip_id=clip.id, job_id=clip.job_id, title=clip.title,
        start_seconds=clip.start_seconds, end_seconds=clip.end_seconds, created_at=clip.created_at,
    )


@router.get("/jobs/{job_id}/clips", response_model=list[JobClipResponse])
def list_job_clips(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[JobClipResponse]:
    get_accessible_job_or_404(db=db, job_id=job_id, user_id=current_user.id)
    clips = db.scalars(select(JobClip).where(JobClip.job_id == job_id).order_by(JobClip.start_seconds, JobClip.created_at)).all()
    return [_clip_response(clip) for clip in clips]


@router.post("/jobs/{job_id}/clips", response_model=JobClipResponse, status_code=201)
def create_job_clip(job_id: str, payload: JobClipRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> JobClipResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    if job.status != "completed":
        raise HTTPException(status_code=409, detail="Clips can be saved after processing completes")
    title = payload.title.strip()
    if not title or payload.end_seconds <= payload.start_seconds:
        raise HTTPException(status_code=422, detail="Clip needs a title and a positive time range")
    duration = job_duration_seconds(job)
    if duration and payload.start_seconds >= duration:
        raise HTTPException(status_code=422, detail="Clip must start within the recording")
    clip = JobClip(job_id=job_id, title=title, start_seconds=payload.start_seconds, end_seconds=payload.end_seconds)
    db.add(clip)
    db.commit()
    db.refresh(clip)
    return _clip_response(clip)


@router.delete("/jobs/{job_id}/clips/{clip_id}", status_code=204)
def delete_job_clip(job_id: str, clip_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Response:
    get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    clip = db.scalar(select(JobClip).where(JobClip.id == clip_id, JobClip.job_id == job_id))
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    db.delete(clip)
    db.commit()
    return Response(status_code=204)


@router.patch("/jobs/{job_id}/project", response_model=JobCreateResponse)
def assign_job_project(
    job_id: str,
    payload: JobProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    if payload.project_id is not None:
        project = db.scalar(select(Project).where(Project.id == payload.project_id, Project.owner_id == current_user.id))
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    job.project_id = payload.project_id
    db.commit()
    db.refresh(job)
    return to_job_response(job)


@router.get("/jobs/{job_id}/shares", response_model=list[CollaboratorResponse])
def list_job_shares(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[CollaboratorResponse]:
    get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    shares = db.scalars(select(JobCollaborator).where(JobCollaborator.job_id == job_id)).all()
    return [CollaboratorResponse(user_id=share.user_id, email=share.user.email) for share in shares]


@router.post("/jobs/{job_id}/shares", response_model=CollaboratorResponse, status_code=201)
def add_job_share(job_id: str, payload: ShareRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CollaboratorResponse:
    get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    email = payload.email.strip().lower()
    invitee = db.scalar(select(User).where(func.lower(User.email) == email))
    if invitee is None:
        raise HTTPException(status_code=404, detail="This person needs a FrameNote account before you can share notes with them")
    if invitee.id == current_user.id:
        raise HTTPException(status_code=400, detail="You already own this note")
    existing = db.scalar(select(JobCollaborator).where(JobCollaborator.job_id == job_id, JobCollaborator.user_id == invitee.id))
    if existing is None:
        db.add(JobCollaborator(job_id=job_id, user_id=invitee.id, role="viewer"))
        db.commit()
    return CollaboratorResponse(user_id=invitee.id, email=invitee.email)


@router.delete("/jobs/{job_id}/shares/{user_id}", status_code=204)
def remove_job_share(job_id: str, user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Response:
    get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    share = db.scalar(select(JobCollaborator).where(JobCollaborator.job_id == job_id, JobCollaborator.user_id == user_id))
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")
    db.delete(share)
    db.commit()
    return Response(status_code=204)


@router.post("/jobs/{job_id}/retry", response_model=JobCreateResponse)
def retry_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried")
    ensure_job_creation_allowed(db=db, user=current_user, source_type=job.source_type)
    job = prepare_job_retry(db=db, job=job)
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    detailed = subscription.tier.lower() == "pro" and subscription.status.lower() == "active"
    task = process_public_video_url if job.source_type in {"url", "youtube"} else process_job
    enqueue_job_task(task, (job.id, detailed), background_tasks, db, job)
    return to_job_response(job)


@router.post("/jobs/{job_id}/action-items", response_model=JobCreateResponse)
def add_job_action_item(
    job_id: str,
    payload: CustomActionItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    job = add_custom_action_item(db=db, job=job, text=payload.text.strip())
    return to_job_response(job)


@router.patch("/jobs/{job_id}/action-items/{index}", response_model=JobCreateResponse)
def set_job_action_item_completion(
    job_id: str,
    index: int,
    payload: ActionItemCompletionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobCreateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    job = set_action_item_completed(db=db, job=job, index=index, completed=payload.completed)
    return to_job_response(job)


@router.post("/jobs/{job_id}/pdf", response_model=PdfGenerateResponse)
def generate_pdf_for_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PdfGenerateResponse:
    job = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    points = json.loads(job.key_points_json or "[]")
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    is_pro = subscription.tier.lower() == "pro" and subscription.status.lower() == "active"
    include_frames = job.source_type == "upload"
    if is_pro:
        asset_key = generate_job_pdf(
            job=job,
            key_points=points,
            analysis=get_job_analysis(job),
            include_frames=include_frames,
        )
    else:
        asset_key = generate_job_summary_pdf(
            job=job,
            key_points=points,
            include_frames=include_frames,
        )
    set_job_pdf_asset_key(db=db, job=job, asset_key=asset_key)
    refreshed = get_job_or_404(db=db, job_id=job_id, owner_id=current_user.id)
    payload = to_job_response(refreshed)
    if not payload.pdf_url:
        raise HTTPException(status_code=500, detail="PDF generation failed")
    return PdfGenerateResponse(pdf_url=payload.pdf_url)


@router.post("/billing/checkout-session", response_model=BillingCheckoutResponse)
def create_checkout_session(
    payload: CheckoutSessionRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BillingCheckoutResponse:
    selection = payload or CheckoutSessionRequest()
    checkout_url = create_checkout_url(
        db=db,
        user=current_user,
        plan=selection.plan,
        billing_cycle=selection.billing_cycle,
    )
    return BillingCheckoutResponse(checkout_url=checkout_url)


@router.post("/billing/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    payload = await request.body()
    handle_webhook_event(db=db, payload=payload, signature=stripe_signature)
    return {"status": "ok"}


@router.post("/uploads/presign", response_model=UploadPresignResponse)
def presign_upload(payload: UploadPresignRequest, request: Request, current_user: User = Depends(get_current_user_bearer_only)) -> UploadPresignResponse:
    check_rate_limit("upload-user", current_user.id, 30, 3600)
    if payload.file_size > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload is too large")
    allowed_video = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".mpeg", ".mpg", ".wmv"}
    allowed_transcript = {".vtt", ".srt", ".txt", ".docx"}
    suffix = Path(payload.file_name).suffix.lower()
    if suffix not in allowed_video | allowed_transcript:
        raise HTTPException(status_code=422, detail="Unsupported upload file type")
    object_key = build_object_key(payload.file_name, current_user.id)
    upload_url, method, headers, fields, expires_in = create_upload_presign(
        object_key=object_key,
        content_type=payload.content_type,
        fallback_base_url=str(request.base_url),
        user_id=current_user.id,
    )
    return UploadPresignResponse(
        object_key=object_key,
        upload_url=upload_url,
        method=method,
        headers=headers,
        fields=fields,
        expires_in_seconds=expires_in,
    )


@router.put("/uploads/mock/{object_key:path}")
async def upload_mock_object(object_key: str, request: Request, upload_token: str | None = None, db: Session = Depends(get_db)) -> Response:
    if settings.environment == "production":
        raise HTTPException(status_code=404, detail="Not found")
    if not upload_token:
        raise HTTPException(status_code=401, detail="Upload link required")
    user_id = verify_upload_token(upload_token, object_key)
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=401, detail="Account not found")
    await save_mock_upload(object_key=object_key, request=request)
    return Response(status_code=200)


_RANGE_RE = re.compile(r"bytes=(\d+)-(\d*)")
_RANGE_CHUNK_SIZE = 1024 * 1024


def _serve_file_with_optional_range(path: Path, request: Request) -> Response:
    """Serve a file, honoring an HTTP Range header so <video> seeking works."""
    file_size = path.stat().st_size
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"

    range_header = request.headers.get("range")
    match = _RANGE_RE.match(range_header) if range_header else None
    if not match:
        return FileResponse(path, media_type=content_type, headers={"Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"})

    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else file_size - 1
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    length = end - start + 1

    def iter_range():
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(_RANGE_CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
    }
    return StreamingResponse(iter_range(), status_code=206, media_type=content_type, headers=headers)


@router.get("/assets/{asset_key:path}")
def get_asset(asset_key: str, request: Request, access_token: str | None = None, db: Session = Depends(get_db)) -> Response:
    if not access_token:
        raise HTTPException(status_code=401, detail="Asset link required")
    user_id, job_id = decode_asset_token(access_token, asset_key)
    asset_user = db.get(User, user_id)
    if asset_user is None or (settings.environment == "production" and asset_user.email == "demo@framenote.local"):
        raise HTTPException(status_code=401, detail="Asset link is no longer valid")
    job = get_accessible_job_or_404(db=db, job_id=job_id, user_id=user_id)
    if not asset_belongs_to_job(job, asset_key):
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset_key.startswith("uploads/"):
        redirect_url = presigned_upload_download_url(asset_key)
        if redirect_url:
            return RedirectResponse(
                redirect_url, status_code=307, headers={"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"}
            )
        path = resolve_uploaded_object_path(asset_key)
    else:
        path = resolve_processed_asset_path(asset_key)
    return _serve_file_with_optional_range(path, request)

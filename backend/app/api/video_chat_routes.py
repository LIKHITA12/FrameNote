from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_bearer_only, get_db
from app.models.user import User
from app.schemas.video_chat import VideoChatAnswerResponse, VideoChatHistoryResponse, VideoChatQuestionRequest
from app.services.jobs import get_accessible_job_or_404
from app.services.video_chat import ask_video_question, get_video_chat_history

router = APIRouter(tags=["Ask this video"])


@router.get("/jobs/{job_id}/chat", response_model=VideoChatHistoryResponse)
def get_job_video_chat(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> VideoChatHistoryResponse:
    job = get_accessible_job_or_404(db=db, job_id=job_id, user_id=current_user.id)
    return get_video_chat_history(db=db, job=job, user=current_user)


@router.post("/jobs/{job_id}/chat", response_model=VideoChatAnswerResponse)
def ask_job_video_chat(
    job_id: str,
    payload: VideoChatQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> VideoChatAnswerResponse:
    job = get_accessible_job_or_404(db=db, job_id=job_id, user_id=current_user.id)
    return ask_video_question(
        db=db,
        job=job,
        user=current_user,
        question=payload.question,
        contexts=payload.contexts,
    )

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_bearer_only, get_db
from app.models.user import User
from app.schemas.key_moments import DetailedKeyMomentsResponse
from app.services.auth import get_user_subscription
from app.services.detailed_key_moments import build_detailed_key_moments
from app.services.jobs import get_accessible_job_or_404
from app.services.media_access import sign_existing_asset_url

router = APIRouter(tags=["Key Moments"])


@router.get(
    "/jobs/{job_id}/detailed-key-moments",
    response_model=DetailedKeyMomentsResponse,
    summary="Get Pro detailed key moments",
)
def get_detailed_key_moments(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_bearer_only),
) -> DetailedKeyMomentsResponse:
    job = get_accessible_job_or_404(db=db, job_id=job_id, user_id=current_user.id)
    subscription = get_user_subscription(db=db, user_id=current_user.id)
    if subscription.tier.lower() != "pro" or subscription.status.lower() != "active":
        raise HTTPException(status_code=403, detail="Detailed key moments require an active Pro subscription.")
    result = build_detailed_key_moments(job)
    for moment in result.items:
        moment.frame_image_url = sign_existing_asset_url(job, moment.frame_image_url, current_user.id)
    return result

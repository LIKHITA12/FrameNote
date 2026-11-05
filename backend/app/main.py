from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.key_moments_routes import router as key_moments_router
from app.api.oauth_routes import router as oauth_router
from app.api.pipeline_routes import router as pipeline_router
from app.api.routes import router
from app.api.video_url_routes import router as video_url_router
from app.api.video_chat_routes import router as video_chat_router
from app.db import Base, SessionLocal, assert_schema_current, engine
from app.models import Job
from app.core.config import settings
from app.services.auth import get_or_create_user, hash_password

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix=settings.api_v1_prefix)
app.include_router(key_moments_router, prefix=settings.api_v1_prefix)
app.include_router(pipeline_router, prefix=settings.api_v1_prefix)
app.include_router(video_url_router, prefix=settings.api_v1_prefix)
app.include_router(video_chat_router, prefix=settings.api_v1_prefix)
app.include_router(oauth_router, prefix=settings.api_v1_prefix)


@app.on_event("startup")
def on_startup() -> None:
    # Production schema changes are applied by Alembic before the API starts.
    if settings.environment == "production":
        assert_schema_current()
        return
    _ = Job
    Base.metadata.create_all(bind=engine)
    if settings.environment == "development":
        _ensure_demo_account()


def _ensure_demo_account() -> None:
    # Keeps the README's documented demo login working now that passwords are required.
    db = SessionLocal()
    try:
        user = get_or_create_user(db=db, email="demo@framenote.local", full_name="Demo User")
        if not user.password_hash:
            user.password_hash = hash_password("password123")
            db.add(user)
            db.commit()
    finally:
        db.close()

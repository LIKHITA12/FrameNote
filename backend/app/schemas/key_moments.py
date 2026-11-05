from pydantic import BaseModel, Field


class DetailedKeyMoment(BaseModel):
    title: str
    start_seconds: int = Field(ge=0)
    end_seconds: int = Field(ge=0)
    frame_timestamp_seconds: int = Field(ge=0)
    bullets: list[str] = Field(default_factory=list)
    frame_image_url: str | None = None


class DetailedKeyMomentsResponse(BaseModel):
    job_id: str
    total: int
    items: list[DetailedKeyMoment] = Field(default_factory=list)

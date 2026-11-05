# FrameNote Implementation Plan

## Locked decisions
- Source support:
  - Uploaded videos: full pipeline (transcript + key points + extracted frame images + PDF export).
  - YouTube links: transcript/captions + embedded YouTube player + timestamp seek only.
- YouTube policy guardrails:
  - No YouTube frame extraction.
  - No storyboard-thumbnail scraping.
  - No screenshot/headless capture workaround.
- Product model: multi-user, public, paid subscriptions.
- Stack:
  - Frontend: Next.js + React + TypeScript + Tailwind.
  - Backend: FastAPI + Celery + Redis + Postgres.
- Hosting target:
  - Frontend on Vercel.
  - Backend worker/API on Render or Railway.
  - Storage on Cloudflare R2.

## Product UX decisions (updated)
- Do not expose raw "jobs" terminology or job IDs in primary UI.
- UI language should be user-centered:
  - "Analyze video", "Recent activity", "Session", "Result", "Export".
- Keep technical queue concepts in backend and admin/debug views only.
- Show history in a user-friendly format, not a developer queue list.

## Repo layout constraint
- Root contains only:
  - frontend/
  - backend/
- No other root-level project files.

## User experience structure
- Primary user flow:
  - Start analysis from a simple input page (YouTube URL or upload).
  - Land on a results experience with summary, key moments, and export actions.
  - Return to a clean activity history to reopen prior sessions.
- History should be presented as a timeline/feed:
  - Group by recency (Today, Yesterday, Earlier).
  - Card-based items with meaningful title (video name), progress state, and last-updated time.
  - No raw IDs shown by default.
- Results page should prioritize:
  - Summary first.
  - Key moments with seek actions.
  - Export controls with clear readiness state.

## High-level architecture
- Frontend responsibilities:
  - Auth + subscription UI.
  - Analyze input flow (upload/YouTube).
  - Activity history feed UI (user-friendly session history).
  - Results UI (summary, key moments, embedded playback, export).
  - Embedded YouTube player sync via timestamp clicks.
  - PDF download action.
- Backend responsibilities:
  - Analysis task creation and orchestration (internal concept; not exposed in UI wording).
  - Queue processing and retries.
  - Video/audio processing for uploads.
  - Transcript + summary + key-point generation.
  - Frame extraction for uploads only.
  - PDF rendering and storage.

## Phase plan
1. Foundation
   - Scaffold frontend and backend.
   - Add env config and local docker compose under backend.
   - Add basic API + UI wiring.
2. Experience-first UI pass
   - Introduce user-friendly navigation and information architecture.
   - Replace technical "job list" presentation with activity feed/timeline.
   - Standardize labels/copy to non-technical language.
3. Upload pipeline
   - Presigned upload to object storage.
   - ffmpeg audio extraction + transcription.
   - Key point generation and frame matching.
4. YouTube pipeline
   - URL validation and caption retrieval.
   - Summary/key points.
   - Embedded player integration with seek-to timestamps.
5. PDF export
   - Render summary + key points + media references.
6. Monetization and hardening
   - Stripe subscriptions/usage limits.
   - Error handling, quotas, observability.

## Immediate implementation baseline (now)
- Frontend app scaffolded in frontend/.
- Backend API scaffolded in backend/.
- Analysis task endpoint connected to frontend submission flow.
- Local compose stack defined in backend/docker-compose.yml.

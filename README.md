# FrameNote

FrameNote turns videos into structured notes. Upload a video or paste a public video link, and get a transcript, AI-generated summary, key moments with timestamps, transcript-grounded chat, and a PDF export.

- **Uploaded videos**: full pipeline — transcript, key points, extracted frame images, and PDF export.
- **YouTube links**: transcript/captions + embedded YouTube player with timestamp seeking (no frame extraction).
- **Any public video link**: `POST /videos/from-url` — audio-only transcription and a text-only PDF, no frames extracted (see below).
- **Ask this video**: saved per-video Q&A grounded in the transcript, with timestamp citations and plan-aware limits.
- **Projects and sharing**: group notes into projects and share individual notes with existing FrameNote users as viewers.
- **Editable notes and clips**: revise a completed summary, decisions, and action items; bookmark timed parts of a recording and search its transcript.

## Tech stack

- **Frontend**: Next.js (App Router) + React + TypeScript + Tailwind CSS
- **Backend**: FastAPI + Celery (task queue) + Redis (broker) + Postgres (database)
- **Storage**: Local disk in dev, Cloudflare R2 in production
- **Optional integrations**: OpenAI (transcription/summaries), Stripe (subscriptions)

## Project structure

```
backend/    FastAPI API, Celery worker, Alembic migrations
frontend/   Next.js app
```

## Prerequisites

- Node.js 20+ and npm
- Python 3.12+
- Docker (recommended, for Postgres/Redis/API/worker via docker-compose)

## Backend setup

The backend can run fully via Docker Compose (API + worker + Redis + Postgres), or locally against SQLite if you don't want to run Docker.

### Option A: Docker Compose (recommended)

1. Create a `backend/.env` file (values are read by `app/core/config.py`):
   ```env
   CORS_ORIGINS=http://localhost:3000
   REDIS_URL=redis://redis:6379/0
   DATABASE_URL=postgresql+psycopg://postgres:postgres@postgres:5432/framenote
   OPENAI_API_KEY=
   OPENAI_VIDEO_CHAT_MODEL=gpt-4o-mini
   # Transcription order: Groq, then local Whisper (if enabled), then OpenAI Whisper, then Gemini (no timestamps).
   # A failing provider falls through to the next one. Free Groq key: console.groq.com
   GROQ_API_KEY=
   GEMINI_API_KEY=
   # Offline fallback; requires `pip install openai-whisper`. Unset = on in development only; blocked in production.
   ENABLE_LOCAL_WHISPER=
   ```
2. From `backend/`, build and start everything:
   ```bash
   cd backend
   docker compose up --build
   ```
   This starts the API on [http://localhost:8000](http://localhost:8000), a Celery worker, Redis, and Postgres.
3. Apply database migrations (in a separate terminal, once containers are up):
   ```bash
   docker compose exec api alembic upgrade head
   ```

### Option B: Run locally without Docker

1. Create and activate a virtual environment, then install dependencies:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Create a `backend/.env` file pointing at local services. For a no-Docker fallback, SQLite works:
   ```env
   CORS_ORIGINS=http://localhost:3000
   DATABASE_URL=sqlite:///./framenote.db
   REDIS_URL=redis://localhost:6379/0
   ```
   (Redis is still required for Celery; run it via `docker run -p 6379:6379 redis:7-alpine` or a local install.)
3. Apply migrations:
   ```bash
   alembic upgrade head
   ```
   If Alembic reports that the existing Neon database already has the tables but has no
   migration history, mark the database as current instead of recreating the tables:
   ```bash
   alembic stamp head
   alembic current
   ```
   Use `alembic stamp head` only when the existing tables already match the checked-out
   application's schema. `alembic current` should then show the latest migration head.
4. Start the API:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
5. In a separate terminal (with the venv activated), start the Celery worker:
   ```bash
   celery -A tasks.worker.celery_app worker --loglevel=info
   ```
   In production, also run `celery -A tasks.worker.celery_app beat` so jobs left behind by a crashed worker are marked failed and can be retried.

The API is served under the `/api/v1` prefix, e.g. [http://localhost:8000/api/v1](http://localhost:8000/api/v1).

### Cloudflare R2 uploads

When using Cloudflare R2, `R2_ENDPOINT` must be the account-level endpoint only, and
`R2_BUCKET` must contain the bucket name separately:

```env
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=<bucket-name>
```

Do not append the bucket name to `R2_ENDPOINT`; the SDK adds it when creating the
presigned PUT upload URL. Also configure the R2 bucket CORS policy to allow the
frontend origin (for local development, `http://localhost:3000`) with `PUT`, `GET`,
and `HEAD` methods and the headers used by the upload. In Cloudflare, open the bucket's
**Settings → CORS policy** and add:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Restart the API after changing `backend/.env`. The R2 access key must have permission
to read and update the bucket's CORS settings; an upload-only key cannot apply this
change.

### Security mode

Local development uses `ENVIRONMENT=development`. For deployment, set `ENVIRONMENT=production`,
`LEGACY_HEADER_AUTH_ENABLED=false`, a unique `JWT_SECRET_KEY` of at least 32 characters,
and the four `R2_*` settings for a private bucket. The API refuses to start with unsafe
production authentication or missing R2 settings. Production startup does not create tables
or a demo account; run `alembic upgrade head` before starting the API.

Uploads require a bearer token. Local upload links and media links expire; every media request
also checks current job access, including shared viewer access. Cloud uploads use a signed R2
form with a size limit. `MAX_UPLOAD_BYTES` sets the server ceiling (2 GiB by default).
Allow browser `POST` requests from the frontend origin in the private R2 bucket's CORS rules.
Password reset remains unavailable in production until an email provider is configured.

### Production PostgreSQL setup

1. Create a managed PostgreSQL database for staging, and a separate one for production. Enable the provider's daily backups and record the retention period. Keep its connection string in the hosting provider's secret settings, not in Git.
2. Set `DATABASE_URL` for both the API and worker to a `postgresql+psycopg://` URL with a non-default password and a TLS query option, for example `?sslmode=require` (use `verify-full` when the provider supplies the needed CA certificate). URL-encode special characters in the username and password. The development `postgres:postgres@postgres` URL and SQLite are rejected in production.
3. Set `DB_POOL_SIZE` and `DB_MAX_OVERFLOW` for each API and worker process. The defaults are 5 and 5, so each process may open up to 10 connections. Keep the total below the database provider's connection limit. `DB_POOL_RECYCLE_SECONDS` defaults to 1800.
4. Before starting a new API or worker release, run `alembic upgrade head` **once** using that release's image and the target environment's secrets. The Docker image includes `alembic.ini` and the migration files. Production API startup checks the `alembic_version` table and refuses to start if the schema is behind.
5. Test a backup by restoring it to a **separate, empty database**, then run `alembic current` against that restored database. Check that expected tables and a sample record are present. Never test a restore over the live database.

The next staging step needs the managed database connection string in your hosting provider, with the database reachable from the API, worker, and one-time migration job. A local Docker PostgreSQL test could not be run in this workspace while the Docker daemon is stopped.

## Frontend setup

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Create a `frontend/.env.local` file pointing at the backend API:
   ```env
   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   If you run into webpack module/chunk errors from `next dev`, use the stable variant instead (and avoid running multiple `next dev` instances at once):
   ```bash
   npm run dev:stable
   ```
4. Open [http://localhost:3000](http://localhost:3000).

## Notes from a public video link

`POST /api/v1/videos/from-url` takes a link instead of a file. It accepts a video page
(YouTube, Vimeo, Loom, ...) or a direct link to a video/audio file, and runs the same
background pipeline the upload flow uses.

```bash
curl -X POST http://localhost:8000/api/v1/videos/from-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/talk.mp4", "detailed": true}'
```

The response is the queued job; poll `GET /api/v1/jobs/{job_id}` until `status` is
`completed`, then read `pdf_url`. Pass `"detailed": false` for the shorter summary-only
report. `POST /api/v1/videos/from-url/preview` resolves a link (title, duration, provider)
without creating a job, so a pasted URL can be checked first.

What it does and does not fetch:

- **No frames are ever extracted**, and the generated PDF contains no stills from the
  source video. Only an upload — a file the user gave us — gets screenshots in its report.
- YouTube links use the video's **published captions**, so nothing is downloaded at all.
  Only when captions are unavailable does it fall back to the audio stream.
- Every other link is fetched **audio-only** (`yt-dlp -f bestaudio`, or a streamed
  download plus `ffmpeg -vn` for direct file links).
- Links are checked before anything is fetched: http/https only, and hosts that resolve to
  loopback/private/link-local addresses are rejected.

Relevant settings (`backend/.env`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VIDEO_URL_MAX_BYTES` | `2147483648` | Hard cap on how much media one link may pull |
| `VIDEO_URL_TIMEOUT_SECONDS` | `900` | Timeout for fetching a direct media link |
| `ALLOW_PRIVATE_VIDEO_URLS` | `false` | Dev/test only: allow localhost/private-network links |

Requires `ffmpeg` on PATH, plus `yt-dlp` (in `requirements.txt`) for video-page links.

## Demo login

```
demo@framenote.local
password123
```

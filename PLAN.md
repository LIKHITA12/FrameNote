# FrameNote Backend API Plan

## Current API inventory

| Endpoint | Method | Used by frontend? | How real is it |
|---|---|---|---|
| /health | GET | Not called by any page (infra/monitoring only) | Real, trivial |
| /users/me | GET | login, signup, TopNav, upgrade | Real DB read, but "auth" trusted an X-User-Email header with no password check |
| /jobs | POST | welcome, workspace/create | Real - creates job row, queues Celery task (or runs inline if no broker) |
| /jobs | GET | home, operations, analyzing, history, insights | Real |
| /jobs/{id} | GET | analyzing (poll), insights (poll) | Real |
| /jobs/{id}/pdf | POST | insights | Real (reportlab) |
| /billing/checkout-session | POST | upgrade | Real if Stripe keys set; else returns hardcoded success URL |
| /billing/webhook | POST | Called by Stripe, not frontend | Real webhook handling (upgrade/downgrade tier) |
| /uploads/presign | POST | workspace/create | Real - R2 presign if configured, else local mock upload URL |
| /uploads/mock/{key} | PUT | workspace/create (direct fetch) | Real local fallback storage |
| /assets/{key} | GET | insights (pdf link/img) | Real FileResponse |

## Fake/mock parts previously hiding behind "real" endpoints
- Auth: any `X-User-Email` header worked, no password verification at all (fixed in Phase 1).
- Billing checkout: hardcoded success URL if Stripe keys unset (unchanged, documented behavior).
- AI summary/key points: hardcoded fallback content if `OPENAI_API_KEY` unset (unchanged so far).
- No subscription quota enforcement (planned Phase 2).

## Build phases
1. **Real authentication** (implemented) - password hashing, JWT login/signup, forgot/reset password, `Authorization: Bearer` token replaces header-only trust.
2. **Subscription quota enforcement** (planned) - limit free-tier jobs/month, surface usage in `/users/me`.
3. **Operations page real data** (planned) - real Speakers/Mentions/Shared files APIs instead of hardcoded UI lists.
4. **Polish/hardening** (planned) - rate limiting, upload size limits, job retry logic.
5. **AI provider cost optimization** (in progress) - Groq Whisper transcription implemented (`GROQ_API_KEY`, long audio auto-chunked under the 25 MB limit), with automatic fallback to local Whisper (`ENABLE_LOCAL_WHISPER`, dev only - blocked in production), then OpenAI, then Gemini; Gemini for summaries/chat.

## Hosting & deployment (decided)
Managed platforms only, no VM/Kubernetes:
- Frontend: Cloudflare Pages (free, no bandwidth limit; app has no server-side Next.js features)
- Backend API + Celery worker + Redis: Railway, starting on Hobby plan (~$5/month)
- Database: Neon (serverless Postgres, scale-to-zero)
- File storage: Cloudflare R2 (free tier, zero egress fees)
- Estimated cost at current scale: ~$5-20/month


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
| /billing/checkout-session | POST | upgrade | Real Dodo Payments checkout if keys set; else returns the success URL (dev only, 503 in production) |
| /billing/portal-session | POST | Not yet (needs a "Manage billing" button) | Real - Dodo customer portal link for updating the card or cancelling |
| /billing/webhook | POST | Called by Dodo Payments, not frontend | Real - Standard Webhooks signature check, upgrades/downgrades tier |
| /uploads/presign | POST | workspace/create | Real - R2 presign if configured, else local mock upload URL |
| /uploads/mock/{key} | PUT | workspace/create (direct fetch) | Real local fallback storage |
| /assets/{key} | GET | insights (pdf link/img) | Real FileResponse |

## Fake/mock parts previously hiding behind "real" endpoints
- Auth: any `X-User-Email` header worked, no password verification at all (fixed in Phase 1).
- Billing checkout: returns the success URL without charging if Dodo keys are unset (development only; production returns 503).
- AI summary/key points: hardcoded fallback content if `OPENAI_API_KEY` unset (unchanged so far).
- No subscription quota enforcement (planned Phase 2).

## Build phases
1. **Real authentication** (implemented) - password hashing, JWT login/signup, forgot/reset password, `Authorization: Bearer` token replaces header-only trust.
2. **Subscription quota enforcement** (planned) - limit free-tier jobs/month, surface usage in `/users/me`.
3. **Operations page real data** (planned) - real Speakers/Mentions/Shared files APIs instead of hardcoded UI lists.
4. **Polish/hardening** (planned) - rate limiting, upload size limits, job retry logic.
5. **AI provider cost optimization** (in progress) - Groq Whisper transcription implemented (`GROQ_API_KEY`, long audio auto-chunked under the 25 MB limit), with automatic fallback to local Whisper (`ENABLE_LOCAL_WHISPER`, dev only - blocked in production), then OpenAI, then Gemini. Gemini is the primary provider for summaries, analysis and video chat, with OpenAI as an optional fallback.

## Services & budget (decided)
Goal: $0 during development, ~$5-10/month at launch (plus ~$10/year for a domain). Managed platforms only, no VM/Kubernetes.
Prices are approximate; check each provider's pricing page before relying on them.

| Need | Service | Development | Launch | Starts costing more when |
|---|---|---|---|---|
| Database | Neon (serverless Postgres, scale-to-zero) | Free | Free | Over ~0.5 GB or free compute hours, then usage-based |
| File storage | Cloudflare R2 | Free | Free | Over 10 GB stored (~$0.015/GB after); zero egress fees |
| Frontend | Cloudflare Pages (static export; no server-side Next.js features) | Free | Free | Unlikely; unlimited bandwidth |
| API + Celery worker + Redis | Railway, Hobby plan | $0 (Redis in local Docker) | ~$5-10/month | Hobby is $5/month incl. $5 usage; more video processing = more usage |
| Summaries, analysis, chat | Gemini | Free tier | Free, then paid | Free rate limits hit; paid Flash-Lite is very cheap per video |
| Transcription | Groq Whisper | Free tier | Free, then paid | Free rate limits hit; paid is a few cents per audio hour |
| Payments | Dodo Payments (replaces Stripe; merchant of record, handles sales tax) | Test mode | No monthly fee | Per-sale fee (~4% + 40¢) |
| Email (password reset) | Resend (suggested) | Free | Free | Over ~3,000 emails/month (100/day) |
| Error alerts | Sentry (optional) | Free | Free | Over ~5,000 errors/month |
| Domain | Cloudflare Registrar | — | ~$10/year | Sold at cost |

Cost notes:
- Run 3 Railway services, not 4: API, worker with embedded beat (`celery ... worker -B`, fine while there is one worker), and Redis. The services reach Redis over Railway's private network via `REDIS_URL=${{Redis.REDIS_URL}}`.
- Gemini's free tier may use request data to improve Google's products. Switch to the paid tier before real users upload private videos.

## Deployment work (planned, in order)
1. **Dodo Payments** (code done 2026-11-21) - `services/billing.py` uses Dodo checkout and verifies webhooks; `Subscription` columns renamed to `payment_customer_id` / `payment_subscription_id` (migration `20261121_0022`); `DODO_*` settings replace `STRIPE_*`; `stripe` package removed. Remaining: create the Dodo account and products, test a purchase in test mode, add a "Manage billing" button that calls `/billing/portal-session`.
2. **Email via Resend** - send real password-reset emails. `/auth/forgot-password` currently returns 503 in production.
3. **Cloudflare Pages** - add `output: "export"` to `next.config.ts`, wrap `useSearchParams` pages in `<Suspense>` if the build needs it, and point `NEXT_PUBLIC_API_BASE_URL` at the Railway API.
4. **Railway** (code done 2026-11-21) - `backend/railway.json` (API: migrations before deploy, health check) and `backend/railway.worker.json` (Celery worker with beat), production installs skip local Whisper (`requirements-dev.txt`), frames and PDFs are stored in R2 so the separate API and worker machines can both read them, and `TRUSTED_PROXY_HOPS=1` keeps rate limits per visitor. Step-by-step guide with every variable: `DEPLOYMENT.md`.
5. **Known fixes** - (done: dispatch checks for a worker before queueing.) Clear the previous summary when a job is retried. Make an empty Gemini reply fall back to OpenAI in `services/analysis.py`. Use the same Gemini model default in `config.py` and `.env.example`.

## Future development: reliable YouTube links
YouTube often blocks requests from cloud servers (Railway), so server-side caption fetching and yt-dlp downloads can fail even when the code is correct. Current fallbacks: upload the video, or upload a `.txt`/`.vtt`/`.srt` transcript. `YOUTUBE_PROXY_URL` (residential proxy) is supported but not configured. Planned options, so the user's own browser (a normal home connection that YouTube trusts) does the YouTube part:

1. **FrameNote Chrome extension** - on a YouTube watch page, a "Send to FrameNote" button reads the published transcript (and title, duration, video id) inside the user's browser and posts it to a new authenticated endpoint, e.g. `POST /api/v1/jobs/from-transcript`. The backend then skips caption fetching/transcription and runs only summary + analysis. Needs: Manifest V3 extension with host permission for `youtube.com` and the FrameNote API, sign-in (reuse the JWT from the web app), Chrome Web Store listing (one-time $5 developer fee), privacy policy entry. Pros: free per video, one click, not blocked. Cons: users must install it; YouTube page changes can break the transcript reader.
2. **Bookmarklet** - a "Send to FrameNote" bookmark the user drags to the toolbar; clicking it on a YouTube video runs a small script in the page that reads the caption track URL from the page's player data, fetches the transcript from youtube.com (same site, so allowed), and posts it to the same endpoint. Pros: free, no store or install. Cons: less polished, harder to explain; some browsers/mobile don't support bookmarklets well.
3. **Gemini reads the YouTube link** (built 2026-11-26) - `services/youtube_transcript.py`: when captions fail, the public YouTube URL is sent to Gemini (Google fetches the video, so Railway isn't blocked) for a `[MM:SS]` transcript; retried once if it errors or stops early; skipped for videos over `YOUTUBE_GEMINI_MAX_SECONDS` (3 h). Tested on a 27-min video: ~30 s, ~90k input + ~6k output tokens. YouTube URL input is a Gemini preview feature (free for now, free tier capped at 8 hours of YouTube video/day; pricing may change). If captions, Gemini and the audio download all fail, the job fails with an "upload the video or paste its transcript" message and the progress modal offers **Paste transcript** / **Upload video** buttons; pasted text is stored as a `.txt` transcript (timestamps like `0:05` or `[00:05]` are kept).
4. **Paid transcript API** (e.g. Supadata, ScrapeCreators, youtube-transcript.io) - per-request cost; some transcribe uncaptioned videos with AI for extra credits.

## Pricing (decided)
Single source of truth: `backend/app/services/plans.py` (catalog copy) and `TIER_QUOTAS` in `backend/app/services/usage.py` (enforced limits).

| | Free Starter | Solo Pro |
|---|---|---|
| Price | $0 | $12/month, or $8/month billed annually ($96/year) |
| Price in India | ₹0 | ₹399/month, or ₹333/month billed annually (₹3,999/year), GST included |
| Uploaded/linked video | 1 hour/month, max 30 min per video | 15 hours/month, max 2 hours per video |
| YouTube caption notes | 3/month | Unlimited |
| Summary + key moments | Yes | Yes |
| Detailed analysis | Preview (overview + first section, locked counts) | Full |
| Ask this video | 3 per video, 10/month | 300/month |
| PDF export | Watermarked summary | Clean summary + detailed |

The full analysis is generated for every job; `analysis_for_viewer` in `services/jobs.py` trims it per viewer (API and video chat), so upgrading unlocks existing videos without reprocessing.
Dodo Payments: create two subscription products, Solo Pro Monthly ($12/month) and Solo Pro Annual ($96/year), and set their IDs as `DODO_PRODUCT_ID_PRO_MONTHLY` / `DODO_PRODUCT_ID_PRO_ANNUAL`. Both products are tax-inclusive.

India pricing (decided 2026-11-21): the same two products use Dodo **Localized Pricing → By Country → India** (₹399 and ₹3,999), so checkout code is unchanged. The upgrade page shows these prices when the browser timezone is India (`detectPricingRegion` in `frontend/src/lib/api.ts` → `/billing/plans?region=IN`); the display prices live in `REGIONAL_PRICING` in `services/plans.py` and must be changed together with the Dodo products.

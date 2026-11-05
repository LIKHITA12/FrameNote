# FrameNote QA Report — Production Readiness

**Date:** 2026-11-05 · **Branch:** DEV, with uncommitted SSO changes · **Scope:** frontend (Next.js) and backend (FastAPI, Celery), end to end

## Verdict: NOT production ready

The core product is well built: authorization on jobs, signed media links, server-side plan enforcement and a clean migration chain are all done properly. But there are **release blockers in four areas**:

1. The build is broken.
2. Payment can be bypassed, so anyone can get Pro for free.
3. SSO allows account takeover.
4. Jobs can get stuck, and the system breaks down under real multi-user load.

The payment page **must not ship** until every item in §2 is fixed.

### What was run

| Check | Result |
|---|---|
| `tsc --noEmit` (frontend) | ✅ Pass |
| `next build` (frontend) | ❌ **FAIL**: `useSearchParams() should be wrapped in a suspense boundary at page "/login"` |
| `pytest` (backend) | ✅ 54 passed (the `test_media_security.py:79` failure was environment-dependent and is fixed) |
| `next lint` | ❌ Can't run: no eslint dependency or config |
| Alembic chain 0001→0020 | ✅ Linear. One drift: `jobs.owner_id` is nullable in the DB but `nullable=False` in the model |
| Frontend ↔ backend API contract | ✅ All paths and fields match, except the `"downgrade"` action (see P-5) |

---

## 1. Release blockers (must fix before any launch)

> **Update 2026-11-05:** B-1 to B-5 are fixed. `next build` passes, and `tests/test_sso_and_billing_security.py` covers each fix. Email verification for password signups still needs an email provider (see S-9).
>
> **Update 2026-11-05 (2):** B-6 to B-11 are fixed, covered by `tests/test_job_reliability_and_ssrf.py`. Production deploys must now also run `celery beat` (added to `docker-compose.yml`) and set `OPENAI_API_KEY` or `GEMINI_API_KEY`.

| # | Sev | Area | Issue | Location | Fix |
|---|---|---|---|---|---|
| B-1 ✅ fixed | Critical | Build | The production build fails. The new SSO code calls `useSearchParams()` in the login page without a `<Suspense>` boundary. | `frontend/src/app/login/page.tsx:42` | Wrap the page body in `<Suspense>`, as `reset-password` does |
| B-2 ✅ fixed | Critical | Payments | **Free Pro upgrade.** The webhook only checks the Stripe signature when a secret *and* a header are present; otherwise it trusts the raw JSON. A POST with no signature header containing `{"type":"checkout.session.completed","data":{"object":{"metadata":{"user_id":"<me>"}}}}` gives that user Pro. | `backend/app/services/billing.py:55-58, 70-81` | Always call `construct_event`; return 400 if the secret or signature is missing or invalid |
| B-3 ✅ fixed | Critical | Auth/SSO | **Account takeover through Microsoft SSO.** Tenant is `common`, the email is taken from Graph `mail`/`userPrincipalName` (which tenant admins control), and accounts are linked by email alone. An attacker sets `mail=victim@x.com` in their own tenant and is logged in as the victim. | `oauth.py:190`, `auth.py:17-21`, `config.py:74` | Link accounts by provider `sub`/`oid`, trust only verified email (`xms_edov`), or restrict the tenant |
| B-4 ✅ fixed | High | Auth/SSO | SSO `state` is a stateless JWT that isn't bound to the browser, so login CSRF works: the victim is silently signed into the attacker's account. | `oauth.py:62-79`, `oauth_routes.py:49-55` | Store a nonce in an HttpOnly cookie and require it to match; add PKCE |
| B-5 ✅ fixed | High | Auth | Email is never verified, whether from Google/Facebook (`email_verified` ignored) or password signup. An attacker can pre-create `victim@gmail.com` with a password; when the victim later uses Google SSO, they land in the attacker's account. | `oauth.py:160-163, 217-221`, `auth.py:105-121` | Require email verification; clear an unverified password on first SSO link |
| B-6 ✅ fixed | Critical | Jobs | **Jobs get stuck in "processing" forever.** Celery has no `acks_late`, time limits or retries, and no sweeper for stale jobs. Retry only accepts `failed`. A deploy or OOM mid-job leaves a permanent spinner, polled every 2s. | `tasks/worker.py:24`, `jobs.py:348` | `acks_late` + `reject_on_worker_lost`, `soft_time_limit`, plus a beat task that fails stale jobs |
| B-7 ✅ fixed | Critical | Storage | Every request to stream a video from R2 (including each HTTP Range request) downloads the whole file, up to 2 GB, into `/tmp`, and concurrent requests write the same file. | `storage.py:92-107` | Redirect to a presigned R2 GET URL, or stream from R2 |
| B-8 ✅ fixed | High | Jobs | If dispatching to Celery fails, the full pipeline (ffmpeg, Whisper, LLM) runs inside the API process, in prod too. | `pipeline_routes.py:54-58, 80-84`, `video_url_routes.py:74-78`, `routes.py:430, 611` | In prod, return 503 or leave the job queued; keep the fallback for dev only |
| B-9 ✅ fixed | High | Config | `temp_` dev code runs in prod: local Whisper is tried first, and an Azure LLM path uses hard-coded UHG endpoints (`api.uhg.com`) with unpinned `requests`/`dotenv`. | `processing.py:198, 312`, `temp_azure_llm.py:23, 51, 54` | Delete these modules or put them behind a flag that is off by default |
| B-10 ✅ fixed | High | Quality | With no AI key configured, jobs still "complete", using a placeholder transcript (which includes a server path) and invented key points. | `processing.py:233-239, 399, 620-647` | Fail the job in production |
| B-11 ✅ fixed | High | SSRF | The URL ingestion check validates DNS once, then follows redirects. yt-dlp fetches freely, and `100.64/10` isn't blocked. A public URL can redirect to `169.254.169.254` (cloud metadata). Errors leak internal status codes. | `video_url.py:117-140, 199, 205-208, 233, 270, 321` | Re-validate every redirect hop and pin the resolved IP (or use an egress proxy); require `is_global` |

## 2. Payment page: required before going live

What exists today: one `checkout.session.create` call, plus a webhook that handles 3 event types. Gaps:

| # | Sev | Issue | Location | Fix |
|---|---|---|---|---|
| P-1 ✅ fixed | Critical | Webhook signature bypass (B-2) | `billing.py:55` | See B-2 |
| P-2 | Critical | No Terms, Privacy or Refund pages. Stripe requires them to activate an account. The signup checkbox references terms but has no links. | `signup/page.tsx:322`, `Footer.tsx` | Add public `/terms`, `/privacy` and `/refunds` pages and link them from the footer, signup and checkout |
| P-3 | Critical | The pricing page (`/upgrade`) and the home page are behind `AuthGuard`, so Stripe's site review and visitors who aren't logged in can't see prices. | `upgrade/page.tsx:462`, `app/page.tsx` | Make a public pricing page; require login only for the checkout button |
| P-4 | High | Only `checkout.session.completed` and `subscription.deleted/paused` are handled. Missing: `customer.subscription.updated` (past_due, unpaid, cancel_at_period_end), `invoice.payment_failed`, `invoice.paid`, and resume. Users keep Pro after their payment fails. | `billing.py:70-91` | Handle these events, and re-fetch the subscription from Stripe to map status to tier |
| P-5 | High | The "Downgrade" button calls checkout with `plan="free"`, which always returns 400 "Unknown plan". | `upgrade/page.tsx:109-121`, `plans.py:227` | Handle `downgrade` by sending the user to the Customer Portal |
| P-6 | High | No Customer Portal endpoint. The "Cancel anytime", "Manage subscription" and "Manage Billing & Invoices" links all just go to `/upgrade`. | `settings/page.tsx:266-271, 806-811` | Add a `POST /billing/portal-session` endpoint and point the links at it |
| P-7 | High | No idempotency: event IDs aren't stored, and a replayed or late `checkout.session.completed` re-grants Pro after cancellation. | `billing.py` | Add a `stripe_events` table and skip event IDs already processed |
| P-8 | Medium | Checkout uses `customer_email` instead of reusing `stripe_customer_id`, and doesn't stop users who already have Pro. Result: duplicate customers and double billing. There's no `client_reference_id`. | `billing.py:33-40` | Get-or-create the Stripe customer; block checkout when the user already has Pro |
| P-9 | Medium | Deleting an account removes the subscription row but doesn't cancel it in Stripe, so the customer keeps being charged. | `user_settings.py:302-320` | Cancel the Stripe subscription before deleting |
| P-10 | Medium | Plan state isn't refreshed after a `?billing=success` redirect. If Stripe keys are missing, the success URL is returned directly and "Payment confirmed" shows with no payment taken. | `upgrade/page.tsx:168-180, 242-246`, `billing.py:25-27` | Poll usage until the tier changes; never fake success in prod |
| P-11 | Medium | The raw Stripe exception text is returned to the client. | `billing.py:43` | Log it and return a generic message |
| P-12 | Medium | No CSP yet; adding one must allow `js.stripe.com`. The prod config validator doesn't require `stripe_webhook_secret` when a Stripe key is set, and doesn't reject localhost success/cancel URLs. | `next.config.ts`, `config.py:79-105` | Add a headers block and the validator checks |
| P-13 | Low | Billing-cycle default differs: Upgrade defaults to annual, Settings sends monthly. "No credit card required" is shown to users who already have Pro. | `upgrade:163, 428-446`, `settings:403` | Make them consistent |

## 3. Security and auth (High / Medium)

| # | Sev | Issue | Location |
|---|---|---|---|
| S-1 | High | Rate limiting uses `request.client.host` with no proxy-header support. Behind a load balancer every user shares one IP, so 5 signups/hour applies to the whole site and one bot locks everyone out. | `rate_limit.py:22-24`, `Dockerfile` CMD |
| S-2 | High | The JWT is in `localStorage`, valid for 30 days, and can't be revoked. A password change or reset doesn't invalidate existing tokens. Reset tokens can be reused for 30 minutes and SSO codes for 2 minutes. | `auth.ts:17-19`, `config.py:59`, `auth.py:57-75, 95, 142-149` |
| S-3 | High | No security headers (CSP, HSTS, frame-ancestors, nosniff) on either the frontend or the API. Swagger `/docs` is public in prod. | `next.config.ts`, `main.py:15` |
| S-4 | Medium | The `X-User-Email` header impersonates any user when `ENVIRONMENT != "production"` (including staging). It defaults to on. | `deps.py:41-46`, `config.py:63` |
| S-5 | Medium | Free-tier quota and chat budget can be beaten with concurrent requests (check and insert aren't atomic). Storage quota is shown but never enforced. | `usage.py:198-221`, `video_chat.py:136-150` |
| S-6 ✅ fixed | Medium | `/pipeline/process-local-file` is only blocked when the environment is exactly `production`. | `pipeline_routes.py:105` |
| S-7 | Medium | `sso_error` from the URL is displayed as-is, so anyone can craft a link showing their own message (phishing text). | `login/page.tsx:72-73` |
| S-8 | Low | Per-account login lockout (10 per 15 minutes) lets anyone lock a specific user out. Asset JWTs sit in URLs for 120 minutes. | `routes.py:158`, `media_access.py:12` |
| S-9 | Low | Password reset returns 503 in prod (no email provider), so prod users have no way to recover their account. | `routes.py:169` |

## 4. Scalability and reliability (real-time, multi-user)

| # | Sev | Issue | Location |
|---|---|---|---|
| R-1 | High | Videos longer than about 26 minutes fail on OpenAI (128 kbps mp3 exceeds the 25 MB limit), but Pro allows 90 minutes. | `processing.py:553`, `video_url.py:316` |
| R-2 | High | No timeouts on ffmpeg `subprocess.run` or on the OpenAI, Azure and Gemini clients. One bad file can block a worker forever. | `processing.py:205, 345, 422, 613`, `analysis.py:235` |
| R-3 | High | Video chat holds a DB connection while waiting up to 60s on the LLM. The pool is 5+5, so about 10 concurrent questions exhaust it and every endpoint stalls. PDF generation runs synchronously in the request. | `video_chat.py:136-176`, `routes.py:642`, `config.py:25-26` |
| R-4 | High | History loads every job (with full transcripts) into memory twice per request and paginates in Python, with an N+1 query on `job.project`. | `history.py:54, 111-124`, `jobs.py:195` |
| R-5 | High | Account deletion raises an IntegrityError on Postgres for users who left feedback (foreign key without `ondelete`). Their files and R2 objects are never deleted. | `user_settings.py:301-320`, migration `0014:30` |
| R-6 | High | Temp dirs and the R2 cache are never cleaned up. Frames and PDFs are written only to local disk, never to R2, so with more than one host the API returns 404 on assets the worker produced. | `processing.py:486, 551`, `pdf.py:40`, `storage.py:103` |
| R-7 | Medium | Progress polling: three pollers fetch the full job (including transcript) every 2–2.5s. The analyzing page sends 2 requests every 2s. Intervals are recreated on every poll, with no backoff, no visibility pause and no stop condition. | `analyzing/page.tsx:125-138`, `insights/page.tsx:569-586`, `ProcessingModal.tsx:175`, `AppTopbar.tsx:69` |
| R-8 | Medium | Worker errors are not logged; raw ffmpeg and yt-dlp stderr is shown to users. No structured logging, request IDs or Sentry/OTel. | `worker.py:54-59` (repeated) |
| R-9 | Medium | Missing indexes on `jobs.status`, `(owner_id, created_at)`, `updated_at` and chat `(role, created_at)`. Tags are stored as JSON text and filtered in Python. | models, `history.py:116`, `notifications.py:45` |
| R-10 | Medium | Ops: the container runs as root with a single uvicorn process and no HEALTHCHECK. `/health` doesn't check the DB or Redis. Compose hardcodes the Postgres password and publishes 5432 and 6379 (Redis has no auth). No restart policies. | `Dockerfile`, `docker-compose.yml:38`, `routes.py:124` |

## 5. Frontend UX and QA

| # | Sev | Issue | Location |
|---|---|---|---|
| F-1 | High | Insights page: a network error, a job ID that doesn't exist, and loading all show "No notes available yet". `refreshInsights` has no catch, so the error is an unhandled rejection. | `insights/page.tsx:391-410, 403, 1047-1050` |
| F-2 | Medium | Logout doesn't reset `ProcessingContext`, so the previous user's job modal can stay visible on `/login` (privacy on shared PCs). It also causes a hydration mismatch. | `logout/page.tsx:15-21` |
| F-3 | Medium | Every login failure (429, 500, offline) is shown as "Invalid email or password". | `api.ts:56-58` |
| F-4 | Medium | Deep links are lost: login always goes to `/` (no same-origin `?next=`). | `AuthGuard.tsx:25`, `api.ts:614` |
| F-5 | Medium | Modals have no `role="dialog"`, focus trap, Escape handling or focus return (add-action-item, edit notes, clip, share, ProcessingModal, TranscriptSourceDialog). | `insights:2010` and others |
| F-6 | Medium | No `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx`, favicon or `public/`. No OpenGraph tags or per-page titles, and no robots or sitemap. | `src/app/` |
| F-7 | Medium | No client error monitoring (Sentry) and no analytics, so payment-flow failures will go unseen. | — |
| F-8 | Medium | `next lint` is unusable: no eslint or eslint-config-next, and no config. | `package.json:11` |
| F-9 | Low | The home page swallows load errors, so a failure looks like an empty history. | `app/page.tsx:120-129` |
| F-10 | Low | Material Symbols is loaded from Google at runtime. If it's blocked, raw icon names like "check_circle" appear as text; it also raises GDPR concerns. | `layout.tsx:33-36` |
| F-11 | Low | The insights page is one 2,086-line component with about 40 `useState` hooks and is hard to test. | `insights/page.tsx` |

## 6. Repo hygiene and tests

- `backend/framenote_test.db` is tracked in git. DB backups (`framenote.db.bak-*`) and `backend/*.pdf` are untracked **and not ignored**, so a `git add .` would commit user data and password hashes. Add `backend/*.db*` and `backend/*.pdf` to `.gitignore` and run `git rm --cached` on the test DB.
- About 21 MB of design assets are committed under `frontend/`: three zips, the `stitch_*` folders, `welcome new/`, `insights/` and `copilot-production-ui-prompt.md`.
- `.env.example` ships `LEGACY_HEADER_AUTH_ENABLED=true` and a placeholder JWT secret. The prod validator rejects both, but the defaults should be safe.
- Test gap: the failing test is environment-dependent. It doesn't override the R2 settings, so local R2 credentials send the presign to R2. No tests cover the worker, processing, video_url, PDF content, billing or webhooks, SSO, or Postgres (SQLite doesn't enforce foreign keys).
- Deprecated or old dependencies: `google-generativeai` (replaced by `google-genai`), `youtube-transcript-api==0.6.2`, FastAPI `on_event`. yt-dlp needs regular upgrades. No CVE scan was run.

## 7. What's done well

- Consistent job authorization: owner checks on every mutation and access checks on every read. No IDOR found.
- Media is served through signed, job-scoped tokens with path-traversal guards and upload keys tied to the uploader.
- bcrypt passwords, a pinned JWT algorithm, and a typed claim on each token so token types can't be swapped.
- A production settings validator (requires a real JWT secret, Postgres with TLS and private R2) and a schema-current check at startup.
- Redis-backed rate limiting that refuses requests if Redis is down. Forgot-password doesn't reveal which emails exist.
- Plan features are enforced server-side, not in the client.
- No `dangerouslySetInnerHTML` on user or AI content. No hardcoded localhost URLs. A central 401 handler.
- The SSO flow exchanges a short-lived code server-side instead of putting the token in the URL.
- Atomic job retry, stage progress that never moves backward, and a clean linear migration chain.

## 8. Recommended order

1. **B-1** (build), **B-2/P-1** (webhook), then **B-3, B-4, B-5** (SSO). These are small, high-impact fixes.
2. **Payment foundation:** P-2 through P-11, plus tests for the webhook and checkout.
3. **Job reliability:** B-6, B-8, B-9, B-10, R-1, R-2.
4. **Scale:** B-7, R-3, R-4, R-6, R-7, S-1.
5. **Hardening and ops:** S-2, S-3, R-8, R-10, F-6, F-7, repo hygiene.
6. **UX polish:** F-1 through F-5.

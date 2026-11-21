# Deploying the FrameNote backend to Railway

This guide puts the backend online on Railway. It is written for a first deployment. Follow it top to bottom.

**What you will end up with:** one Railway project with 3 services:

| Service | What it does | Public address? |
|---|---|---|
| `api` | The FastAPI server the website talks to | Yes, e.g. `https://framenote-api-production.up.railway.app` |
| `worker` | Celery: transcribes and analyses videos in the background, plus the periodic cleanup sweep (beat) | No |
| `Redis` | The job queue between `api` and `worker` | No, private network only |

Database (Neon) and file storage (Cloudflare R2) stay where they are; Railway only runs the code.

**Cost:** the Railway free trial ($5 credit, 30 days, no card) covers testing. Switch to Hobby ($5/month) before real users. See `PLAN.md` → Services & budget.

---

## Step 0 — Push the code to GitHub

Railway builds straight from your GitHub repository (`LIKHITA12/FrameNote`), so every change must be committed and pushed first. Railway rebuilds automatically on every push to `main`.

## Step 1 — Create the Railway account

1. Go to **railway.com** → **Login** → **Login with GitHub**.
2. Allow Railway to access your GitHub account. **Verify your GitHub account if asked**: without it you get a "Limited Trial" that blocks outgoing connections, and FrameNote must reach Neon, R2, Gemini, Groq and Dodo.
3. Pick the free trial. No card needed.

## Step 2 — Create the project and the Redis service

1. Click **New Project** → **Deploy from GitHub repo** → choose **FrameNote**. If the repo is not listed, click **Configure GitHub App** and give Railway access to it.
2. Railway creates one service and starts building it. Let it fail or cancel it; we configure it first.
3. In the project canvas click **+ Create** (or **New**) → **Database** → **Add Redis**. A `Redis` service appears.

## Step 3 — Configure the `api` service

Click the service created from the repo, then **Settings**:

| Setting | Value |
|---|---|
| Service name (top of Settings) | `api` |
| **Source → Root Directory** | `/backend` |
| **Config-as-code → Railway Config File** | `/backend/railway.json` |
| **Networking → Public Networking** | Click **Generate Domain**, port `8000` if it asks |

`railway.json` already tells Railway to build the `Dockerfile`, run database migrations (`alembic upgrade head`) before each deploy, start the API, and check `/api/v1/health`.

Copy the generated domain (e.g. `https://framenote-api-production.up.railway.app`). It is your **API address** below.

## Step 4 — Add the `api` variables

In the `api` service open **Variables** → **Raw Editor** and paste the block below, replacing each `<...>`. The table after it says where every value comes from.

```
ENVIRONMENT=production
LEGACY_HEADER_AUTH_ENABLED=false
JWT_SECRET_KEY=<generate, see table>
DATABASE_URL=<Neon connection string>
REDIS_URL=${{Redis.REDIS_URL}}
TRUSTED_PROXY_HOPS=1
PUBLIC_API_BASE_URL=<API address>
FRONTEND_BASE_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
GEMINI_API_KEY=<from your local .env>
GEMINI_MODEL=gemini-3.5-flash-lite
GROQ_API_KEY=<from your local .env>
R2_ENDPOINT=<from your local .env>
R2_ACCESS_KEY_ID=<from your local .env>
R2_SECRET_ACCESS_KEY=<from your local .env>
R2_BUCKET=<from your local .env>
BILLING_SUCCESS_URL=http://localhost:3000/upgrade?billing=success
BILLING_CANCEL_URL=http://localhost:3000/upgrade?billing=cancel
```

**Do not add the `DODO_*` variables yet.** Production refuses to start with a Dodo API key but no webhook secret, and the webhook secret only exists after the API has an address (Step 7).

| Variable | Where it comes from |
|---|---|
| `JWT_SECRET_KEY` | Generate a new random one, never reuse the dev value. In a terminal run `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` and paste the output. |
| `DATABASE_URL` | Neon console → your project → **Connect** → copy the connection string. It must contain `sslmode=require`. See the note on databases below. |
| `REDIS_URL` | Type it exactly as shown: `${{Redis.REDIS_URL}}` makes Railway fill in the private Redis address. |
| `TRUSTED_PROXY_HOPS` | Exactly `1`. Railway's proxy sits in front of the API; this makes rate limits see each visitor's real IP instead of the proxy's. |
| `PUBLIC_API_BASE_URL` | The API address from Step 3, with `https://` and no trailing slash. Used in links to video frames. |
| `FRONTEND_BASE_URL`, `CORS_ORIGINS`, `BILLING_*_URL` | `localhost:3000` for now, so your local frontend can talk to the deployed API. Change them to the Cloudflare Pages address when the frontend is deployed. |
| `GEMINI_*`, `GROQ_API_KEY`, `R2_*` | Copy the values from `backend/.env` on your Mac. |

**Database note:** your local `.env` points at your Neon database. For this test deployment the same database is fine. Before real users, create a separate one so testing never touches customer data: Neon console → **Branches** → **Create branch** named `production` (free), and use that branch's connection string here.

## Step 5 — Create the `worker` service

1. In the project canvas click **+ Create** → **GitHub Repo** → **FrameNote** again. A second service from the same repo appears.
2. In its **Settings**:

| Setting | Value |
|---|---|
| Service name | `worker` |
| **Source → Root Directory** | `/backend` |
| **Config-as-code → Railway Config File** | `/backend/railway.worker.json` |
| **Networking** | Leave public networking **off**: the worker needs no address |

`railway.worker.json` starts Celery with the built-in beat scheduler and 2 parallel jobs.

3. **Variables** → **Raw Editor**: paste **the same block as the `api` service** (same values). The worker needs the database, Redis, AI keys and R2 too.

## Step 6 — Deploy and check

1. Railway shows a **Deploy** / **Apply changes** button at the top of the canvas. Click it.
2. Watch each service's **Deployments → View logs**. The first build takes a few minutes.
   - `api` logs should show the migrations, then `Uvicorn running on http://0.0.0.0:...`.
   - `worker` logs should show `celery@... ready` and `beat: Starting...`.
3. Open `<API address>/api/v1/health` in your browser. It should answer `{"status":"ok"}`.

If a service crashes, the first lines of its log say why. The most common cause is a settings error such as `Production requires ...`; the message names the variable to fix.

## Step 7 — Connect Dodo Payments (webhook)

1. Dodo dashboard (Test Mode) → **Developer → Webhooks → Add Endpoint**.
2. URL: `<API address>/api/v1/billing/webhook`
3. Events: select the **subscription** events (or all events).
4. Save, open the endpoint and copy its **Signing Secret** (starts with `whsec_`).
5. In Railway add these to **both** `api` and `worker` (Variables → Raw Editor), using the values from your local `backend/.env` plus the new secret:

```
DODO_PAYMENTS_API_KEY=<from your local .env>
DODO_PAYMENTS_WEBHOOK_KEY=<whsec_... from step 4>
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PRODUCT_ID_PRO_MONTHLY=<from your local .env>
DODO_PRODUCT_ID_PRO_ANNUAL=<from your local .env>
```

6. Click **Deploy**. Railway restarts the services with the new variables.

## Step 8 — Test the whole flow from your Mac

Until the frontend is on Cloudflare Pages, run it locally but point it at Railway:

1. In `frontend/.env.local` set `NEXT_PUBLIC_API_BASE_URL=<API address>/api/v1`.
2. `cd frontend && npm run dev`, open http://localhost:3000.
3. Sign up, analyse a short video, then **Upgrade** → pay with a Dodo test card.
4. Within a few seconds the account should switch to **Solo Pro**. If it doesn't, check Dodo → Webhooks → your endpoint → delivery attempts, and the `api` logs.

Change `NEXT_PUBLIC_API_BASE_URL` back to `http://localhost:8000/api/v1` for local development.

---

## Later: going live

- [ ] Frontend deployed to Cloudflare Pages; update `FRONTEND_BASE_URL`, `CORS_ORIGINS`, `BILLING_*_URL` on both services, and add the Pages address to the R2 bucket's CORS rules (browsers upload videos straight to R2).
- [ ] Separate Neon `production` branch in `DATABASE_URL`.
- [ ] Railway Hobby plan ($5/month) before the trial credit runs out.
- [ ] Dodo live mode: business verification, live API key, live product IDs, live webhook secret, `DODO_PAYMENTS_ENVIRONMENT=live_mode`.
- [ ] Gemini paid tier, so users' video content is not used to improve Google's models.
- [ ] Email provider for password resets (`/auth/forgot-password` returns 503 in production until then).

# Insights Page Roadmap — close gaps vs. the Stitch mockup

> This document is distinct from the root [PLAN.md](PLAN.md) ("FrameNote Backend API Plan"),
> which covers auth/quota/operations/hardening/AI-cost-optimization for the whole backend.
> This roadmap is scoped specifically to the `/workspace/insights` report page: closing the
> gap between the current implementation and a richer "Q3 Product Strategy Review" mockup
> (`frontend/insights/code.html`, `frontend/insights/DESIGN.md`, screenshot) that the user
> approved across all 4 tiers, plus real video playback for uploaded sources.

## Context

User attached a richer mockup for the insights page. Compared against the current
implementation at `frontend/src/app/workspace/insights/page.tsx`. User approved **all 4
tiers (Tier 1–4)** plus real video playback for uploaded sources.

## Key existing-code facts (verified)

- `backend/app/services/analysis.py` `build_detailed_analysis()` ALREADY computes, for every
  normal job (`detailed=True` is the default in `run_job_pipeline`,
  `backend/app/services/processing.py` line ~21): overview, headlines, timeline (list of
  `{title, start_seconds, end_seconds, bullets}`), questions_and_answers (list of
  `{time_seconds, asked_by, question, answer}`), decisions (`list[str]`), action_items
  (`list[str]`), terms/glossary (list of `{term, meaning}`), participants
  (`{names, count, source}`), duration_seconds. Stored in `Job.analysis_json`
  (`backend/app/models/job.py`) but was never exposed via `JobCreateResponse`
  (`backend/app/schemas/jobs.py`) or `to_job_response()` (`backend/app/services/jobs.py`)
  before Phase 1 — only consumed by `generate_job_pdf` (`services/pdf.py`).
  → Tier 1 is pure plumbing + new UI, no new AI calls needed.
- decisions/action_items are flat strings today, no owner/due-date/priority/status — Tier 2 work.
- participants = face/name detection from frames only, NOT speaker-diarization (no turn counts,
  no airtime %, no per-section presenter attribution) — Tier 3 work, needs a real diarization
  capability which doesn't exist in the stack.
- Uploaded videos originally had ZERO playback (page.tsx showed a static frame image). No
  endpoint served the raw uploaded file; `resolve_uploaded_object_path` (`services/storage.py`)
  was internal-only. Addressed in Phase 2 with a new streaming endpoint.
- Transcript text is generated during processing but was discarded, never persisted to `Job` —
  needed for the raw-transcript tab, in-video full-text search, and the AI chat Q&A feature.
  Addressed in Phase 2 (`Job.transcript_text`).
- RISK (from repo memory): huggingface.co is policy-blocked on this dev network. Real speaker
  diarization libraries (pyannote.audio etc.) pull weights from HF Hub — likely won't work here.
  Needs an explicit vendor decision (e.g. Azure Speech diarization via the UHG gateway, if
  available) before Tier 3 speaker-airtime work can start.
- External Notion/Google Docs/Linear sync needs OAuth/API credentials. Account-to-account
  viewer sharing is implemented inside FrameNote and needs no external credentials.

## Phases

### Phase 1 — Expose existing analysis data (low effort, no new AI calls)

1. Backend: add nested schemas to `backend/app/schemas/jobs.py`: `TimelineSection`, `QAItem`,
   `GlossaryTerm`, `ParticipantsInfo`, `JobAnalysis` (overview, headlines, timeline,
   questions_and_answers, decisions, action_items, terms, participants, duration_seconds). Add
   `analysis: JobAnalysis | None` and `created_at: datetime` fields to `JobCreateResponse`.
2. Backend: update `to_job_response()` in `backend/app/services/jobs.py` to populate `analysis`
   via existing `get_job_analysis(job)` helper, and `created_at=job.created_at`.
3. Frontend: mirror types in `frontend/src/types/job.ts` (`JobAnalysis`, `TimelineSection`,
   `QAItem`, `GlossaryTerm`, `ParticipantsInfo`), add `analysis?` and `created_at` to
   `JobCreateResponse`.
4. Frontend UI additions in `page.tsx` (all gated on `result.analysis` being present, graceful
   fallback to current flat-summary view for older jobs without it):
   - Title row: add "Recorded `<date>`" badge (from `created_at`) and "`<N>` participants"
     badge (`analysis.participants.count`).
   - New "Key Decisions Made" card (list of decisions).
   - New "Strategic Themes & Key Discussion Topics" card using `analysis.timeline` (numbered,
     with start-end time range + bullets) — distinct from the existing image-based "Key moments
     & slide captures" section (keep both).
   - New "Open Questions & Answers" card using `questions_and_answers`.
   - Optional "Glossary" card using `terms` (small addition, no extra cost).
   - Right-column "Summary" tab: prefer `analysis.overview`/`headlines` + decisions preview when
     present, fall back to current `result.summary` + top-3-key-points behavior otherwise.

### Phase 2 — Data model upgrades + real uploaded-video playback (*depends on Phase 1 schemas*)

5. Structured action items & decisions: change `analysis.py` prompts (`_CHUNK_PROMPT` /
   `_REDUCE_PROMPT`) and merge functions to return objects `{title, owner?, due?, priority?,
   status}` instead of plain strings; update `JobAnalysis` schema + `pdf.py` rendering to handle
   the new shape (keep a `.title` fallback so PDF code needs minimal changes). **PARTIAL** —
   generated action items now carry optional owner, due, and priority details beside the existing
   string list. Structured decisions and editing are still open.
6. Persist transcript: add `Job.transcript_text` (nullable Text) column + migration; set it in
   `processing.py` after transcription. Expose via a field on `JobCreateResponse`. Add a "Raw
   Transcript" tab in the AI notes card. **DONE** — `transcript_text` column + migration
   `20261002_0009_add_job_transcript_text.py`, `run_job_pipeline()` now returns `transcript` in
   its result dict, `mark_job_completed()` persists it to `Job.transcript_text`,
   `JobCreateResponse.transcript_text` exposes it, and the Raw Transcript tab in `page.tsx`
   renders the real text (with a copy button) when present, falling back to an explanatory
   placeholder for older jobs that predate this column.
7. Model attribution: add `Job.transcription_model` / `Job.summary_model` nullable columns, set
   them in `processing.py` based on which backend path actually succeeded
   (`temp_local_whisper`/openai/`temp_azure_llm`/gemini/placeholder). Expose in
   `JobCreateResponse`; render as a small badge ("Synthesized by `<model>`"). **DONE** — new jobs
   record the transcription source and summary provider; older jobs show no attribution.
8. Real video playback for uploads: **DONE**.
   - New `/api/v1/assets/{asset_key}` dispatch in `routes.py` serves uploads via
     `resolve_uploaded_object_path`, streamed with HTTP Range support
     (`_serve_file_with_optional_range`) so native `<video>` seeking works.
   - `video_url` added to `JobCreateResponse` when `source_type == "upload"`.
   - Frontend renders a real `<video>` element; `jumpTo()` picks the YouTube `playerRef` vs
     HTML5 `videoRef` seek path based on `result.youtube_video_id`.
   - Stretch items (`.vtt` captions, custom playback-speed controls) not yet done.

### Phase 3 — New AI capability (*depends on Phase 2 transcript persistence*)

9. AI chat Q&A: **DONE** — `GET/POST /api/v1/jobs/{job_id}/chat` restores and extends a saved
   per-video conversation. It selects relevant timestamped transcript excerpts, calls the existing
   Azure/OpenAI/Gemini provider chain, validates citation IDs server-side, and tracks model-token
   usage. The Insights page opens a responsive docked “Ask this video” workspace with no backdrop,
   so the video and notes remain visible and interactive. Active tabs and selected note text attach
   named contexts such as Summary, Action items, and Full detailed notes to the next question.
10. Speaker airtime/diarization card — **BLOCKED** on a vendor decision (see risk above). Once
    chosen, add a diarization step producing per-speaker turns+timestamps, store alongside
   `analysis_json`, render a "Speaker Participation" card (% bars, turn counts, jump-to-moment
    per speaker). Current "Speakers & participants" card intentionally shows only names/count/
    detection-source (no fake airtime data) and has been restyled as an avatar-grid roster per
    user feedback, pending this decision.

### Phase 4 — Collaboration & integrations (largest effort, several items need external credentials)

11. Raw Markdown export (no credentials needed): add a markdown renderer from the analysis
    payload, new export option "Raw Markdown (.md)" in the export dropdown, ships independently
    of the rest. **DONE** — the Insights Export menu downloads summary, timeline, action items,
    and transcript as a Markdown file when available.
12. Projects grouping: new `projects` table + `jobs.project_id` nullable FK + migration; CRUD
    endpoints; breadcrumb "Projects / `<project>` / `<job>`" in `page.tsx`; project picker in
    create/history pages. **DONE** — project creation and selection on Dashboard, filtering,
    rename and delete in History, and reassignment on Insights. Deleting a project keeps its notes.
13. Sharing & permissions: new `job_collaborators` table (job_id, user_id/email, role) +
    migration; endpoints to invite/list/remove; update `get_job_or_404` / `list_jobs_for_owner`
    to include shared jobs; "Share" button + dropdown in `page.tsx`. **DONE (viewer role)** —
    owners can grant/revoke read access for existing FrameNote accounts. Shared notes appear
    in jobs and History; owner-only writes remain protected.
14. Inline edit of AI notes: `PATCH /jobs/{job_id}` endpoint to update summary/decisions/action
    items; "Edit Notes" button + edit mode in `page.tsx`. **DONE** — owners can revise
    completed notes; existing PDF exports are invalidated so the next export uses the edits.
15. Clip bookmarks + full-text video search: new `job_clips` table + endpoints; "Add Clip"
    button; extend existing `momentQuery` search to also match transcript text (now unblocked
    since Phase 2 persists `transcript_text`); ⌘K focuses the search input. **DONE** —
    owners save and remove timed clips; shared viewers can read them. Transcript matches
    with timestamps can jump into the video.
16. Transcription usage quota: usage tracking (processed seconds) tied to Subscription tier; new
    column/table + accumulate on job completion; expose via `/users/me`; sidebar progress bar.
    **IMPLEMENTED WITH LIMITS** — monthly counts and known media runtime are checked before
    processing; runtime is stored on each job and shown through `/users/me/usage`. A public link
    without duration metadata can only be checked after its audio is read.
17. Notion / Google Docs / Linear sync — **BLOCKED** until the user supplies credentials (Notion
    integration token + target page/DB id; Google OAuth client for Docs API; Linear API
    key/workspace). Code the export/sync functions once credentials are available; Linear sync
    also depends on structured action items (step 5).

## Relevant files

- `backend/app/schemas/jobs.py` — nested models, `JobCreateResponse` fields (incl.
  `transcript_text`)
- `backend/app/services/jobs.py` — `to_job_response()`, `mark_job_completed()`, new helpers
- `backend/app/services/analysis.py` — prompt/merge changes for structured decisions/action items
- `backend/app/services/processing.py` — persists transcript, (future) model attribution
- `backend/app/models/job.py` + alembic migrations — `transcript_text` (done), future
  `transcription_model`, `summary_model`, `project_id` columns; future projects/
  job_collaborators/job_clips tables
- `backend/app/api/video_chat_routes.py` and `backend/app/services/video_chat.py` — persisted,
  transcript-grounded “Ask this video” endpoints, quotas, provider calls, and citations
- `backend/app/api/routes.py` — `/jobs/{id}/video` (via `/assets/{asset_key}`), future
  `PATCH /jobs/{id}`, projects/collaborators/clips endpoints
- `backend/app/services/storage.py` — reuse `resolve_uploaded_object_path` for streaming
- `backend/app/services/pdf.py` — adjust to tolerate structured decisions/action items (future)
- `frontend/src/types/job.ts` — mirrored TS types
- `frontend/src/app/workspace/insights/page.tsx` — all UI sections, video player, tabs, query bar
- `frontend/src/lib/api.ts` — API client functions

## Verification

1. Phase 1: existing jobs with `analysis_json` show Decisions/Themes/Q&A/Glossary cards; jobs
   created before this change (no `analysis_json`) still render the old flat-summary layout
   without errors. ✅ verified.
2. Phase 2: upload a video, confirm `<video>` plays and seeks (Range requests return 206);
   confirm transcript tab shows real text for newly processed jobs and a graceful placeholder
   for older jobs; confirm model badge shows correct backend used (pending step 7).
3. Phase 3: ask a question in the chat drawer, confirm the saved answer references transcript
   content and each timestamp chip seeks the video. ✅ automated service/API coverage added;
   final provider-specific answer quality should be checked with a real recording.
4. Phase 4: markdown export downloads valid .md; project breadcrumb reflects real project name;
   sharing a job with a second test user grants them read access via `GET /jobs`. Backend
   integration coverage added for project assignment, viewer access, and revocation.

## Progress log

- **2026-10-02 — Phase 1 (steps 1-4)** IMPLEMENTED and verified: `schemas/jobs.py` has
  `JobAnalysis`/`TimelineSection`/`QAItem`/`GlossaryTerm`/`ParticipantsInfo` +
  `JobCreateResponse.analysis`/`created_at`; `services/jobs.py::to_job_response()` populates via
  new `_parse_job_analysis()` (validates with `JobAnalysis.model_validate`, degrades to `None` on
  `ValidationError` instead of 500); frontend `types/job.ts` mirrors types; `page.tsx` adds Key
  Decisions / Strategic Themes & Timeline / Open Questions & Answers / Glossary cards (all gated
  on `result.analysis` presence), recorded-date + participant-count title badges, and the
  right-column Summary tab now prefers `analysis.overview`/`headlines`/`decisions` with fallback
  to old flat-summary behavior. Verified live against job
  `c9901577-5072-4763-ab90-d641827ed56a` via curl — analysis populates correctly, no validation
  errors.
- **2026-10-02 — follow-up fixes round 1** (post-Phase-1 user feedback) IMPLEMENTED:
  1. Removed standalone left "Key decisions made" card (duplicate of right Summary tab
     preview); full decisions list moved into a new "Full Detailed Notes" tab instead.
  2. Widened page container from `max-w-[1280px]` to `max-w-[1760px]`.
  3. Added "Speakers & participants" card using existing `ParticipantsInfo`
     (names/count/source) — true per-speaker airtime % requires diarization (not implemented,
     needs huggingface which is network-blocked per repo memory); card is honest about this
     limitation, no fake data.
  4. Converted vertical AI-notes/Strategic-themes/QA/Glossary/Key-moments stack into a 3-tab
     nav: "Executive Summary" / "Full Detailed Notes" / "Raw Transcript" (`leftTab` state). Raw
     Transcript tab showed a placeholder since `transcript_text` wasn't persisted yet.
  5. Added "Action items" KPI card + full Action Items SectionCard in Full Detailed Notes tab.
  6. Added real video playback for uploads: new backend `video_url` field, `/assets/{asset_key}`
     route dispatches frames/pdf vs uploads/ and streams with HTTP Range support so native
     `<video>` seeking works. Added path-traversal guard in `resolve_uploaded_object_path`.
     Frontend added `videoRef`, renders `<video controls>` for `result.video_url`, `jumpTo()`
     checks `result.youtube_video_id` to pick the YouTube vs HTML5 seek path.
  Verified live: curl confirms `video_url` populates, Range request returns 206 with correct
  `Content-Range`, path traversal attempt returns 404/400, `action_items` populates (4-5 items
  per job).
- **2026-10-02 — follow-up fixes round 2** (second user feedback pass) IMPLEMENTED:
  1. Removed the "Key decisions made" card entirely (was duplicated by the right Summary tab
     preview and the full list wasn't adding value as a separate card).
  2. Moved "Action items" out of the left Full Detailed Notes tab into a new "Action items" tab
     in the right column, positioned beside "Chapters".
  3. Gave "Key moments & slide captures" its own new left-column tab ("Key Moments"), separate
     from "Full Detailed Notes".
  4. Moved the "Glossary" card out of the left Full Detailed Notes tab into the right column,
     positioned directly above the "Recent notes" card (always visible when terms exist, not
     gated by a tab).
  5. Implemented real raw transcript persistence: `Job.transcript_text` column + Alembic
     migration `20261002_0009_add_job_transcript_text.py` (applied locally via
     `alembic upgrade head`); `processing.py::run_job_pipeline()` now returns the full
     transcript text in its result dict; `jobs.py::mark_job_completed()` persists it;
     `JobCreateResponse.transcript_text` exposes it; `page.tsx`'s Raw Transcript tab renders the
     real text in a scrollable panel with a copy button, falling back to an explanatory message
     for jobs processed before this column existed (their `transcript_text` is `NULL`).
  6. Restyled "Speakers & participants" as an avatar-grid roster (larger gradient avatar
     circles, 2-letter initials, card-per-person grid layout) per user feedback that the
     previous pill-list style didn't match the mockup's visual language — still no fabricated
     airtime/turn-count data, since real diarization remains blocked (see Further
     Considerations).
  Verified live: curl confirms `transcript_text` key is present (null) on all pre-existing jobs
  and the field round-trips correctly through `GET /jobs`; frontend compiles with no
  TypeScript/lint errors.

- **2026-10-22 — workflow and reliability pass:** Added failed-job retry, enforced the published
  monthly Free Starter counts and known media runtime limits, recorded transcription and summary
  providers on new jobs, displayed owner/due/priority for generated action items when clearly
  stated, and added Markdown export. Fixed fresh SQLite migration setup. Verified all five
  navigation destinations in headless Chrome, uploaded a small test video with a transcript,
  downloaded its Markdown report, checked the free-plan rejection, and retried a failed test job.

## Decisions

- Tier 1 ships first since it's pure plumbing (no new AI cost) and immediately richer than
  today.
- Keep flat decisions/action_items rendering in Phase 1 (no owner tags yet) to avoid blocking on
  Phase 2's prompt rework.
- Markdown export (step 11) pulled out of the Tier 4 "integrations" bucket and can ship anytime
  since it needs no external credentials.
- Raw transcript persistence (step 6) was pulled forward and completed ahead of step 5
  (structured decisions/action items) and step 7 (model attribution) based on direct user
  request.

## Further Considerations

1. Speaker diarization vendor choice (Phase 3, step 10) — huggingface-based libraries are
   blocked on this dev network per repo memory. Options: Azure Speech Service diarization (if
   reachable via the UHG gateway — unconfirmed), a paid API (AssemblyAI/Deepgram), or defer this
   specific card. The current avatar-grid "Speakers & participants" card is a deliberate stopgap
   that only shows names/count/detection-source, not fabricated airtime percentages.
2. Tier 4 external integrations (step 17) need the user to supply API credentials (Notion token,
   Google OAuth client, Linear API key) before any integration code can be written/tested —
   recommend starting Phase 4 with steps 11-16 (no external creds needed) and treating step 17
   as a follow-up once credentials are available.
3. Given the very large total scope (17 steps across 4 phases, several needing new DB
   migrations and one needing an unresolved vendor choice), recommend executing phase-by-phase
   with a handoff/review after each phase rather than attempting all 4 phases in one
   implementation pass.
4. Older jobs (processed before the `transcript_text` column existed) will permanently show the
   "transcript wasn't persisted" placeholder unless re-processed — there is no way to
   retroactively recover a transcript that was never stored.

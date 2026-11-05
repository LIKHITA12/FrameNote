"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthGuard } from "@/components/AuthGuard";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { StatusBanner } from "@/components/ui/StatusBanner";
import { getJob, listJobs, retryJob } from "@/lib/api";
import { jobSourceLabel } from "@/lib/jobThumbnail";
import { JobCreateResponse } from "@/types/job";

type StepState = "done" | "active" | "pending" | "error";

function stepState(order: number, status: JobCreateResponse["status"]): StepState {
  const stage = status === "queued" ? 0 : status === "processing" ? 1 : status === "completed" ? 3 : 1;
  if (status === "failed") {
    if (order < stage) return "done";
    if (order === stage) return "error";
    return "pending";
  }
  if (order < stage) return "done";
  if (order === stage) return "active";
  return "pending";
}

function StepIcon({ state }: { state: StepState }) {
  const base = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold";
  if (state === "done") {
    return (
      <span className={`${base} border-brand/30 bg-brand/15 text-brand-dark`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className={`${base} border-transparent bg-brand text-white shadow-sm ring-4 ring-brand/15`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 animate-spin">
          <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className={`${base} border-danger/30 bg-danger-soft text-danger`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M4.9 19h14.2a1 1 0 0 0 .87-1.5L13.87 4.5a1 1 0 0 0-1.74 0L5.03 17.5A1 1 0 0 0 4.9 19Z" />
        </svg>
      </span>
    );
  }
  return <span className={`${base} border-core-outline-variant bg-core-surface-container-low text-core-outline`} />;
}

function AnalyzingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedJobId = searchParams.get("job");

  const [job, setJob] = useState<JobCreateResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Real pipeline transitions recorded by the backend as each stage completed.
  const log = useMemo(
    () =>
      (job?.stage_events ?? []).map((event) => ({
        time: new Date(event.at).toLocaleTimeString(),
        text: event.message,
      })),
    [job]
  );

  async function onRetry() {
    if (!job) return;
    setRetrying(true);
    setRetryError(null);
    try {
      setJob(await retryJob(job.job_id));
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Could not retry this job.");
    } finally {
      setRetrying(false);
    }
  }

  // Resolve which job to track: an explicit ?job= id, or the most recent active job.
  useEffect(() => {
    let cancelled = false;

    async function resolveJob() {
      try {
        if (requestedJobId) {
          const found = await getJob(requestedJobId);
          if (!cancelled) setJob(found);
          return;
        }
        const jobs = await listJobs(20);
        const active = jobs.find((item) => item.status === "queued" || item.status === "processing") ?? jobs[0] ?? null;
        if (!cancelled) {
          if (active) {
            setJob(active);
          } else {
            setNotFound(true);
          }
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    }

    void resolveJob();
    return () => {
      cancelled = true;
    };
  }, [requestedJobId]);

  // Poll for real status updates while the job is in flight.
  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") {
      return;
    }
    const intervalId = window.setInterval(async () => {
      try {
        const latest = await getJob(job.job_id);
        setJob(latest);
      } catch {
        // Ignore transient polling failures.
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [job]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Redirect to the full insights view once analysis wraps up.
  useEffect(() => {
    if (job?.status === "completed") {
      const timeoutId = window.setTimeout(() => {
        router.push(`/workspace/insights?job=${job.job_id}`);
      }, 1200);
      return () => window.clearTimeout(timeoutId);
    }
  }, [job, router]);

  const sourceLabel = useMemo(() => {
    if (!job) return "";
    return job.source_type === "upload"
      ? job.file_name || "Uploaded video"
      : job.file_name || job.source_url || "Video link";
  }, [job]);

  if (notFound) {
    return (
      <WorkspaceShell title="Active Processing" subtitle="Synthesizing video content into actionable intelligence.">
        <div className="rounded-[1.5rem] border border-dashed border-core-outline-variant bg-core-surface-container-low px-6 py-10 text-center text-sm text-core-on-surface-variant">
          No job is currently processing.{" "}
          <Link href="/" className="font-semibold text-brand hover:underline">
            Start a new analysis
          </Link>
          .
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      title="Active Processing"
      subtitle="Synthesizing video content into actionable intelligence. The AI is analyzing the latest submission."
      actions={
        <Link
          href="/workspace/history"
          className="rounded-xl border border-core-outline-variant bg-core-surface-container-lowest px-3.5 py-2 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container-low"
        >
          Back to history
        </Link>
      }
    >
      {!job ? (
        <div className="flex items-center justify-center rounded-[1.5rem] border border-core-outline-variant/80 bg-core-surface-container-lowest py-16">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden="true" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_2fr]">
          <div className="flex flex-col gap-4">
            <section className="overflow-hidden rounded-[1.5rem] border border-core-outline-variant/80 bg-core-surface-container-lowest shadow-[0_18px_42px_-30px_rgba(2,6,23,0.45)]">
              <div className="relative aspect-video bg-slate-900">
                {job.youtube_video_id ? (
                  <img
                    src={`https://img.youtube.com/vi/${job.youtube_video_id}/hqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover opacity-70"
                  />
                ) : null}
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
                  {job.status === "completed" ? (
                    <StepIcon state="done" />
                  ) : job.status === "failed" ? (
                    <StepIcon state="error" />
                  ) : (
                    <span className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
                  )}
                </div>
              </div>
              <div className="p-4">
                <h2 className="truncate text-base font-semibold text-ink">{sourceLabel}</h2>
                <p className="mt-1 text-xs uppercase tracking-wider text-core-outline">
                  {jobSourceLabel(job)}
                </p>
                <div className="mt-3 rounded-xl border border-core-outline-variant bg-core-surface-container-low px-3.5 py-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                    <span>Status</span>
                    <span className="text-brand-dark">{job.status}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-core-outline-variant">
                    <div
                      className={`h-full rounded-full bg-brand transition-all duration-700 ${
                        job.status === "queued" || job.status === "processing" ? "w-2/3 animate-pulse" : "w-full"
                      }`}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-core-outline-variant/80 bg-core-surface-container-lowest p-4 shadow-[0_18px_42px_-30px_rgba(2,6,23,0.45)]">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-core-on-surface-variant">Job details</h3>
              <dl className="mt-2 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-core-on-surface-variant">Job ID</dt>
                  <dd className="truncate font-mono text-xs text-core-on-surface-variant">{job.job_id}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-core-on-surface-variant">Source</dt>
                  <dd className="capitalize text-core-on-surface">{job.source_type}</dd>
                </div>
              </dl>
            </section>

            {job.status === "failed" ? (
              <StatusBanner tone="error">
                {job.error_message || "This job failed to process."}{" "}
                <button type="button" onClick={() => void onRetry()} disabled={retrying} className="font-semibold underline disabled:opacity-50">
                  {retrying ? "Retrying…" : "Retry this job"}
                </button>
              </StatusBanner>
            ) : null}
            {retryError ? <StatusBanner tone="error">{retryError}</StatusBanner> : null}
            {job.status === "completed" ? (
              <StatusBanner tone="success">Analysis complete. Redirecting to insights…</StatusBanner>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <section className="rounded-[1.5rem] border border-core-outline-variant/80 bg-core-surface-container-lowest p-5 shadow-[0_18px_42px_-30px_rgba(2,6,23,0.45)]">
              <h2 className="text-lg font-semibold text-ink">Synthesis pipeline</h2>
              <div className="relative mt-5 space-y-6 pl-1">
                <div className="absolute bottom-6 left-4 top-4 w-px bg-core-outline-variant" aria-hidden="true" />
                {[
                  { label: "Uploading & queueing", detail: "Preparing the media source for processing." },
                  { label: "Transcribing & analyzing", detail: "Converting audio to text and identifying key moments." },
                  { label: "Generating summary", detail: "Formatting insights into the final note." },
                ].map((step, index) => {
                  const state = stepState(index, job.status);
                  return (
                    <div key={step.label} className="relative flex items-start gap-3">
                      <StepIcon state={state} />
                      <div className="flex-1 pt-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-ink">{step.label}</h4>
                          <span
                            className={`text-xs font-semibold ${
                              state === "active"
                                ? "text-brand"
                                : state === "error"
                                  ? "text-danger"
                                  : state === "done"
                                    ? "text-core-on-surface-variant"
                                    : "text-core-outline"
                            }`}
                          >
                            {state === "done" ? "Complete" : state === "active" ? "In progress" : state === "error" ? "Failed" : "Pending"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-core-on-surface-variant">{step.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-slate-800 bg-brand-ink shadow-[0_18px_42px_-30px_rgba(2,6,23,0.6)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-300">Processing log</h3>
                {job.status === "queued" || job.status === "processing" ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-light">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-brand-light" /> Live
                  </span>
                ) : null}
              </div>
              <div ref={logRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-xs text-slate-300">
                {log.length === 0 ? (
                  <p className="text-slate-500">Waiting for activity…</p>
                ) : (
                  log.map((entry, index) => (
                    <div key={`${entry.time}-${index}`} className="flex gap-2">
                      <span className="shrink-0 text-brand-light/80">[{entry.time}]</span>
                      <span className="text-slate-400">{entry.text}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export default function AnalyzingPage() {
  return (
    <AuthGuard>
      <AnalyzingPageContent />
    </AuthGuard>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useProcessing } from "@/components/ProcessingContext";
import { getJob } from "@/lib/api";
import { jobSourceLabel, jobThumbnail } from "@/lib/jobThumbnail";
import { JobCreateResponse } from "@/types/job";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

type StepState = "done" | "active" | "pending" | "error";

const STAGES: Array<{ icon: string; title: string; readyText: string; activeText: string }> = [
  {
    icon: "graphic_eq",
    title: "Audio Extracted",
    readyText: "Full speech captured cleanly & normalized.",
    activeText: "Extracting a clean audio track…",
  },
  {
    icon: "record_voice_over",
    title: "Transcribed",
    readyText: "Speech converted to text with timestamps.",
    activeText: "Transcribing speech to text…",
  },
  {
    icon: "psychology",
    title: "AI Summarizing",
    readyText: "Executive summary & key moments ready.",
    activeText: "Distilling executive summary & key moments…",
  },
  {
    icon: "article",
    title: "Generate Report",
    readyText: "Ready as a shareable note & PDF export.",
    activeText: "Formatting the final note…",
  },
];

function stepState(order: number, job: JobCreateResponse): StepState {
  const stage = job.processing_stage ?? 0;
  if (job.status === "completed") return "done";
  if (job.status === "failed") {
    if (order <= stage) return "done";
    if (order === stage + 1) return "error";
    return "pending";
  }
  if (order <= stage) return "done";
  if (order === stage + 1) return "active";
  return "pending";
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Backend failures can carry huge raw provider payloads (HTML error pages, base64 blobs).
// Surface only a short, readable first line.
function friendlyError(raw: string | null | undefined): string {
  if (!raw) return "Something went wrong while processing this video.";
  const firstLine = raw.split(/[\r\n]/)[0].trim();
  if (/403|forbidden/i.test(firstLine)) {
    return "The AI provider rejected the request (403 Forbidden). This is usually a network proxy or an invalid/missing API key.";
  }
  if (/401|unauthorized|api key/i.test(firstLine)) {
    return "The AI provider rejected the credentials. Check the API key configured for the backend.";
  }
  if (/timed? ?out|timeout/i.test(firstLine)) {
    return "The AI provider timed out. Please try again.";
  }
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

type Insight = { icon: string; iconClassName: string; label: string; text: string; tag?: string };

function buildInsights(job: JobCreateResponse): Insight[] {
  const stage = job.processing_stage ?? 0;

  if (stage < 2) {
    return [
      {
        icon: "graphic_eq",
        iconClassName: "bg-core-surface-container text-core-on-surface-variant",
        label: "Listening",
        text: "Capturing audio and speech patterns from your video…",
      },
    ];
  }
  if (stage < 3) {
    return [
      {
        icon: "record_voice_over",
        iconClassName: "bg-core-surface-container text-core-on-surface-variant",
        label: "Transcript captured",
        text: "Scanning the transcript for decisions, speakers, and action items…",
      },
    ];
  }

  const insights: Insight[] = [];
  if (job.summary) {
    insights.push({
      icon: "summarize",
      iconClassName: "bg-core-primary/10 text-core-primary",
      label: "Executive Summary",
      text: job.summary,
    });
  }
  job.key_points.slice(0, 3).forEach((point) => {
    insights.push({
      icon: "task_alt",
      iconClassName: "bg-state-warning-soft text-state-on-warning-soft",
      label: `Key Moment · ${formatTimestamp(point.timestamp_seconds)}`,
      text: `${point.title} — ${point.description}`,
    });
  });
  if (insights.length === 0) {
    insights.push({
      icon: "task_alt",
      iconClassName: "bg-core-primary text-core-on-primary",
      label: "Action Items Extracted",
      text: "Generating…",
      tag: "Generating",
    });
  }
  return insights;
}

export function ProcessingModal() {
  const router = useRouter();
  const { activeJobId, preparing, preparingLabel, uploadProgress, minimized, minimize, restore, dismiss } =
    useProcessing();
  const [job, setJob] = useState<JobCreateResponse | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!activeJobId) {
      setJob(null);
      notifiedRef.current = false;
      return;
    }

    let cancelled = false;
    let intervalId = 0;
    let reachedTerminal = false;

    async function poll() {
      try {
        const latest = await getJob(activeJobId as string);
        if (cancelled) return;
        setJob(latest);
        if (latest.status === "completed" || latest.status === "failed") {
          // Guard against the first poll resolving before the interval is assigned.
          reachedTerminal = true;
          if (intervalId) window.clearInterval(intervalId);
        }
      } catch {
        // Ignore transient polling failures; the next tick retries.
      }
    }

    void poll();
    intervalId = window.setInterval(poll, 2500);
    if (reachedTerminal) window.clearInterval(intervalId);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId]);

  useEffect(() => {
    if (!job || notifiedRef.current || !notifyEnabled) return;
    if (job.status === "completed" || job.status === "failed") {
      notifiedRef.current = true;
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(job.status === "completed" ? "Your note is ready" : "Processing failed", {
          body: job.file_name || job.source_url || "FrameNote",
        });
      }
    }
  }, [job, notifyEnabled]);

  if (preparing) {
    const hasProgress = typeof uploadProgress === "number";
    const finalizing = hasProgress && uploadProgress >= 100;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-[28px] border border-core-primary/10 bg-core-surface p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-core-primary to-core-surface-tint text-core-on-primary shadow-md">
            <Icon name={finalizing ? "auto_awesome" : "cloud_upload"} className={`!text-[28px] ${finalizing ? "animate-spin" : "animate-pulse"}`} />
          </div>
          <h2 className="mt-4 text-lg font-bold tracking-tight text-core-on-surface">
            {finalizing ? "Finalizing upload\u2026" : "Uploading your video"}
          </h2>
          <p className="mt-1 truncate text-[13px] font-medium text-core-on-surface-variant">
            {preparingLabel || "Preparing your file for processing\u2026"}
          </p>
          <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-core-surface-container">
            <div
              className="h-full rounded-full bg-gradient-to-r from-core-primary to-core-surface-tint transition-[width] duration-300 ease-out"
              style={{ width: hasProgress && !finalizing ? `${uploadProgress}%` : "100%" }}
            />
          </div>
          {hasProgress && !finalizing ? (
            <p className="mt-2 font-mono text-xs font-semibold text-core-primary">{uploadProgress}%</p>
          ) : null}
          <p className="mt-4 text-[11px] text-core-on-surface-variant">
            {finalizing ? "Creating your job\u2026 this only takes a moment." : "Processing starts automatically once the upload finishes."}
          </p>
        </div>
      </div>
    );
  }

  if (!activeJobId || !job) return null;

  function onNotifyClick() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotifyEnabled(true);
      return;
    }
    void Notification.requestPermission().then((permission) => {
      setNotifyEnabled(permission === "granted");
    });
  }

  function onViewInsights() {
    const jobId = job!.job_id;
    dismiss();
    router.push(`/workspace/insights?job=${jobId}`);
  }

  const stage = job.processing_stage ?? 0;
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";
  const percent = isDone
    ? 100
    : Math.min(96, Math.round((stage / 4) * 100) + (job.status === "processing" ? 10 : 0));
  const remainingSeconds = Math.max(3, (4 - stage) * 12);
  const insights = buildInsights(job);
  const sourceLabel =
    job.source_type === "upload"
      ? job.file_name || "Uploaded video"
      : job.file_name || job.source_url || "Video link";
  const thumbnail = jobThumbnail(job);

  if (minimized) {
    return (
      <div className="fixed bottom-6 right-8 z-[100] flex items-center gap-3.5 rounded-full border border-core-outline-variant/40 bg-core-surface/95 px-4 py-2.5 shadow-lg backdrop-blur-md">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-core-primary/10 text-core-primary">
          <Icon name={isDone ? "check_circle" : isFailed ? "error" : "sync"} className={`!text-[18px] ${!isDone && !isFailed ? "animate-spin" : ""}`} />
        </div>
        <button type="button" onClick={restore} className="flex min-w-0 flex-col items-start text-left">
          <span className="block max-w-[200px] truncate text-sm font-semibold text-core-on-surface">{sourceLabel}</span>
          <span className="text-xs text-core-on-surface-variant">
            {isDone ? "Ready to view" : isFailed ? "Processing failed" : `Stage ${stage}/4 · ${percent}%`}
          </span>
        </button>
        <button
          type="button"
          onClick={restore}
          className="flex h-7 w-7 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container hover:text-core-primary"
          title="Expand"
        >
          <Icon name="open_in_full" className="!text-[16px]" />
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flex h-7 w-7 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container hover:text-danger"
          title="Dismiss"
        >
          <Icon name="close" className="!text-[16px]" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-[940px] overflow-y-auto rounded-[28px] border border-core-primary/10 bg-core-surface p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-core-primary to-core-surface-tint text-core-on-primary shadow-md">
              <Icon name="auto_awesome" className="!text-[26px]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-core-on-surface sm:text-[23px]">
                  {isDone ? "Your notes are ready" : isFailed ? "Processing hit a snag" : "Turning your video into actionable notes"}
                </h1>
                {!isDone && !isFailed ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-core-primary/20 bg-core-primary/10 px-3 py-1 text-xs font-semibold text-core-primary">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-core-primary" />
                    In Progress · ~{remainingSeconds}s left
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] font-medium leading-relaxed text-core-on-surface-variant">
                {isFailed
                  ? friendlyError(job.error_message)
                  : "FrameNote AI is indexing key decisions, speakers, and summary takeaways for your team."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 self-end sm:self-center">
            {!isDone && !isFailed ? (
              <button
                type="button"
                onClick={onNotifyClick}
                className="inline-flex items-center gap-2 rounded-xl border border-core-outline-variant/40 bg-core-surface-container-lowest px-3.5 py-2 text-[13px] font-semibold text-core-on-surface-variant shadow-sm transition hover:bg-core-surface-container-high"
              >
                <Icon name={notifyEnabled ? "notifications_active" : "notifications"} className="!text-[17px] text-core-primary" />
                {notifyEnabled ? "Notifying" : "Notify when ready"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-core-outline-variant/20 bg-core-surface-container-low/60 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-3.5">
              <div className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-core-outline-variant/20 bg-core-on-surface">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnail} alt="" className="h-full w-full object-cover opacity-80" />
                ) : (
                  <Icon name="movie" className="!text-[20px] text-core-on-primary" />
                )}
              </div>
              <div>
                <h2 className="text-[15px] font-bold tracking-tight text-core-on-surface">{sourceLabel}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] font-medium text-core-on-surface-variant">
                  <span>{jobSourceLabel(job)} processed</span>
                  <span>&bull;</span>
                  <span className="flex items-center gap-1 font-semibold text-state-on-success-soft">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-state-success" />
                    {job.status === "queued" ? "Queued" : job.status}
                  </span>
                </div>
              </div>
            </div>
            <div className="self-end pl-2 text-right md:self-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-core-on-surface-variant/70">
                Total Progress
              </div>
              <div className="font-mono text-sm font-extrabold text-core-primary">{percent}%</div>
            </div>
          </div>
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-core-surface-container">
            <div
              className="retro-progress-bar h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((meta, index) => {
            const order = index + 1;
            const state = stepState(order, job);
            const isActive = state === "active";
            const isStepDone = state === "done";
            const isError = state === "error";
            return (
              <div
                key={meta.title}
                className={`relative flex flex-col justify-between rounded-2xl p-4 transition-all ${
                  isStepDone
                    ? "border border-state-success/40 bg-state-success-soft/40"
                    : isActive
                    ? "border-2 border-core-primary bg-gradient-to-b from-core-primary/10 to-core-surface shadow-md"
                    : isError
                    ? "border border-danger/30 bg-danger-soft"
                    : "border border-core-outline-variant/20 bg-core-surface-container-lowest opacity-80"
                }`}
              >
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                        isStepDone
                          ? "bg-state-success-soft text-state-on-success-soft"
                          : isActive
                          ? "bg-core-primary-container/15 text-core-primary"
                          : isError
                          ? "bg-danger-soft text-danger"
                          : "bg-core-surface-container text-core-on-surface-variant"
                      }`}
                    >
                      <Icon name={meta.icon} className={`!text-[18px] ${isActive ? "animate-pulse" : ""}`} />
                    </div>
                    {isStepDone ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-state-success text-canvas">
                        <Icon name="check" className="!text-[13px]" />
                      </span>
                    ) : isError ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-canvas">
                        <Icon name="close" className="!text-[13px]" />
                      </span>
                    ) : isActive ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-core-primary text-core-on-primary">
                        <Icon name="progress_activity" className="!text-[13px] animate-spin" />
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-core-surface-container text-[10px] font-bold text-core-on-surface-variant">
                        {order}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-bold text-core-on-surface">
                    {order}. {meta.title}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-core-on-surface-variant">
                    {isStepDone ? meta.readyText : isActive ? meta.activeText : meta.readyText}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-core-outline-variant/15 pt-2 text-[11px] font-semibold">
                  {isStepDone ? (
                    <span className="flex items-center gap-1.5 text-state-on-success-soft">
                      <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                      Ready
                    </span>
                  ) : isActive ? (
                    <>
                      <span className="text-core-primary">Synthesizing…</span>
                      <span className="font-mono text-[10px] text-core-primary">
                        Step {order}/4
                      </span>
                    </>
                  ) : isError ? (
                    <span className="text-danger">Failed</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-core-on-surface-variant/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-core-outline-variant" />
                      Up next
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-core-outline-variant/20 bg-core-surface-container-low/40 p-4 shadow-sm sm:p-5">
          <div
            className={`flex items-center justify-between border-b transition-[margin,padding,border-color] duration-300 ease-in-out ${insightsExpanded ? "mb-3.5 border-core-outline-variant/15 pb-3.5" : "mb-0 border-transparent pb-0"}`}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-core-primary-container/15 text-core-primary">
                <Icon name="tips_and_updates" className="!text-[15px]" />
              </div>
              <span className="text-xs font-bold tracking-tight text-core-on-surface sm:text-sm">
                Live Preview of Discovered Insights
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!isDone ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-state-success/40 bg-state-success-soft px-2.5 py-0.5 text-[11px] font-semibold text-state-on-success-soft">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-state-success" />
                  Live Stream
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setInsightsExpanded((expanded) => !expanded)}
                aria-expanded={insightsExpanded}
                aria-label={insightsExpanded ? "Collapse insights" : "Expand insights"}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-core-on-surface-variant transition hover:bg-core-surface-container-high"
              >
                <Icon
                  name="expand_more"
                  className={`!text-[18px] transition-transform duration-300 ease-in-out ${insightsExpanded ? "rotate-180" : "rotate-0"}`}
                />
              </button>
            </div>
          </div>
          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${insightsExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          >
            <div className="min-h-0 space-y-2.5">
              {insights.map((insight, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-xl border border-core-outline-variant/15 bg-core-surface p-2.5 shadow-sm sm:p-3"
                >
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${insight.iconClassName}`}>
                    <Icon name={insight.icon} className="!text-[16px]" />
                  </div>
                  <div className="text-[13px] leading-relaxed">
                    <span className="font-semibold text-core-on-surface">{insight.label}:</span>
                    <span className="ml-1 text-core-on-surface-variant">{insight.text}</span>
                    {insight.tag ? (
                      <span className="ml-1.5 text-[11px] font-semibold text-core-primary">{insight.tag}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-core-outline-variant/15 pt-4 text-xs text-core-on-surface-variant sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-state-success" />
            <span>Safe &amp; private: encrypted end-to-end processing</span>
          </div>
          <div className="flex items-center gap-3">
            {isDone ? (
              <>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container-high"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={onViewInsights}
                  className="rounded-xl bg-core-primary px-4 py-2 text-xs font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint"
                >
                  View Insights
                </button>
              </>
            ) : isFailed ? (
              <>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container-high"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={onViewInsights}
                  className="rounded-xl bg-core-primary px-4 py-2 text-xs font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint"
                >
                  View Details
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-core-primary transition hover:bg-core-surface-container-high"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={minimize}
                  className="rounded-xl bg-core-primary px-4 py-2 text-xs font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint"
                >
                  Run in Background
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

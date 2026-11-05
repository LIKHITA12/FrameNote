"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import YouTube from "react-youtube";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { Footer } from "@/components/Footer";
import { AuthGuard } from "@/components/AuthGuard";
import { DetailedKeyMoments } from "@/components/insights/DetailedKeyMoments";
import { AskVideoDrawer } from "@/components/insights/AskVideoDrawer";
import { useSidebar } from "@/components/SidebarContext";
import {
  addJobShare,
  addJobActionItem,
  assignJobProject,
  createJobClip,
  deleteJobClip,
  generatePdf,
  getDetailedKeyMoments,
  getJob,
  getUserProfile,
  listJobs,
  listJobShares,
  listJobClips,
  listProjects,
  removeJobShare,
  retryJob,
  setJobActionItemCompleted,
  updateJobNotes,
} from "@/lib/api";
import { jobSourceIcon, jobSourceLabel } from "@/lib/jobThumbnail";
import { downloadReportMarkdown } from "@/lib/exportMarkdown";
import {
  DetailedKeyMoment,
  JobCollaborator,
  JobClip,
  JobCreateResponse,
  KeyPoint,
  Project,
  SentimentLabel,
  TranscriptSegment,
  UserProfileResponse,
  VideoChatContext,
} from "@/types/job";

type PlayerLike = { seekTo: (seconds: number, allowSeekAhead: boolean) => void; getCurrentTime: () => number };

type ReportTab = "summary" | "moments" | "chapters" | "actionItems" | "transcript";
type LeftTab = "speakers" | "detailed" | "moments";

const REPORT_CHAT_CONTEXT: Record<ReportTab, VideoChatContext> = {
  summary: { context_id: "summary", label: "Summary" },
  moments: { context_id: "highlights", label: "Highlights" },
  chapters: { context_id: "chapters", label: "Chapters" },
  actionItems: { context_id: "action-items", label: "Action items" },
  transcript: { context_id: "raw-transcript", label: "Raw transcript" },
};

const LEFT_CHAT_CONTEXT: Record<LeftTab, VideoChatContext> = {
  speakers: { context_id: "speakers", label: "Speakers & participants" },
  detailed: { context_id: "detailed-notes", label: "Full detailed notes" },
  moments: { context_id: "key-moments", label: "Key moments" },
};

const GLOSSARY_CHAT_CONTEXT: VideoChatContext = { context_id: "glossary", label: "Glossary" };
const MAX_CHAT_CONTEXTS = 8;

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function toClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Fixed (non-dynamic) class names so Tailwind's JIT compiler picks them up at build time.
const SPEAKER_COLORS = [
  { bar: "bg-indigo-600", dot: "bg-indigo-600", avatarBg: "bg-indigo-600", avatarText: "text-white" },
  { bar: "bg-violet-500", dot: "bg-violet-500", avatarBg: "bg-violet-500", avatarText: "text-white" },
  { bar: "bg-indigo-300", dot: "bg-indigo-300", avatarBg: "bg-indigo-200", avatarText: "text-indigo-900" },
  { bar: "bg-slate-500", dot: "bg-slate-500", avatarBg: "bg-slate-500", avatarText: "text-white" },
  { bar: "bg-sky-500", dot: "bg-sky-500", avatarBg: "bg-sky-500", avatarText: "text-white" },
  { bar: "bg-rose-400", dot: "bg-rose-400", avatarBg: "bg-rose-400", avatarText: "text-white" },
] as const;

function speakerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function highlightMatches(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return text;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark key={index} className="rounded bg-state-warning/30 px-0.5 text-core-on-surface">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

// Transcript import bakes "Speaker: " into segment.text; strip it since the speaker is shown separately.
function segmentDialogue(segment: TranscriptSegment): string {
  if (!segment.speaker) {
    return segment.text;
  }
  const prefix = `${segment.speaker}:`;
  return segment.text.startsWith(prefix) ? segment.text.slice(prefix.length).trimStart() : segment.text;
}

function jobTitle(job: JobCreateResponse | null): string {
  if (!job) {
    return "No note selected";
  }
  if (job.file_name) {
    return job.file_name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
  }
  if (job.source_url) {
    return job.source_url;
  }
  return `Note ${job.job_id.slice(0, 8)}`;
}

function formatRecordedDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function readMinutes(job: JobCreateResponse | null): number {
  if (!job) {
    return 0;
  }
  const words = [job.summary, ...job.key_points.map((point) => `${point.title} ${point.description}`)]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const SENTIMENT_META: Record<SentimentLabel, { icon: string; iconClass: string; caption: string }> = {
  Positive: {
    icon: "sentiment_satisfied",
    iconClass: "bg-state-success-soft text-state-on-success-soft",
    caption: "Upbeat, positive tone",
  },
  Neutral: {
    icon: "sentiment_neutral",
    iconClass: "bg-core-surface-container-high text-core-on-surface-variant",
    caption: "Matter-of-fact tone",
  },
  Negative: {
    icon: "sentiment_dissatisfied",
    iconClass: "bg-state-danger-soft text-state-on-danger-soft",
    caption: "Critical or frustrated tone",
  },
};

const STATUS_META: Record<JobCreateResponse["status"], { label: string; dot: string; chip: string }> = {
  completed: {
    label: "AI synthesis ready",
    dot: "bg-state-success",
    chip: "bg-state-success-soft text-state-on-success-soft",
  },
  processing: {
    label: "Synthesizing",
    dot: "bg-core-primary animate-pulse",
    chip: "bg-core-surface-container-high text-core-primary",
  },
  queued: {
    label: "Queued",
    dot: "bg-state-warning animate-pulse",
    chip: "bg-state-warning-soft text-state-on-warning-soft",
  },
  failed: {
    label: "Failed",
    dot: "bg-state-danger",
    chip: "bg-state-danger-soft text-state-on-danger-soft",
  },
};

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-core-outline-variant/20 bg-core-surface-container-lowest shadow-[0_4px_12px_rgba(15,23,42,0.05)] ${className}`}
    >
      {children}
    </div>
  );
}

function TabScrollArea({ children, context }: { children: React.ReactNode; context: VideoChatContext }) {
  return (
    <div
      role="region"
      aria-label={`${context.label} tab content`}
      data-chat-context-id={context.context_id}
      data-chat-context-label={context.label}
      tabIndex={0}
      className="max-h-[72vh] overflow-y-auto overscroll-contain rounded-2xl pr-2 [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-core-primary lg:max-h-[760px]"
    >
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  caption,
  icon,
  tone = "primary",
  iconClassName,
}: {
  label: string;
  value: string;
  caption: string;
  icon: string;
  tone?: "primary" | "secondary";
  iconClassName?: string;
}) {
  return (
    <SectionCard className="flex flex-1 flex-col justify-between p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-jetbrains-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-core-outline">{label}</span>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            iconClassName ??
            (tone === "primary"
              ? "bg-core-surface-container-high text-core-primary"
              : "bg-core-secondary-container text-core-on-secondary-container")
          }`}
        >
          <Icon name={icon} className="!text-[16px]" />
        </div>
      </div>
      <div>
        <div className="font-display text-xl font-bold leading-tight text-core-on-surface">{value}</div>
        <p className="mt-0.5 text-[12px] text-core-on-surface-variant">{caption}</p>
      </div>
    </SectionCard>
  );
}

function InsightsPageContent() {
  const searchParams = useSearchParams();
  const requestedJobId = searchParams.get("job");
  const { collapsed } = useSidebar();

  const [history, setHistory] = useState<JobCreateResponse[]>([]);
  const [result, setResult] = useState<JobCreateResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [shares, setShares] = useState<JobCollaborator[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [editNotesOpen, setEditNotesOpen] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editDecisions, setEditDecisions] = useState("");
  const [editActionItems, setEditActionItems] = useState("");
  const [editNotesBusy, setEditNotesBusy] = useState(false);
  const [editNotesError, setEditNotesError] = useState<string | null>(null);
  const [clips, setClips] = useState<JobClip[]>([]);
  const [clipOpen, setClipOpen] = useState(false);
  const [clipTitle, setClipTitle] = useState("");
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(30);
  const [clipBusy, setClipBusy] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [detailedMoments, setDetailedMoments] = useState<DetailedKeyMoment[]>([]);
  const [detailedMomentsLoading, setDetailedMomentsLoading] = useState(false);
  const [detailedMomentsError, setDetailedMomentsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTimestamp, setActiveTimestamp] = useState<number | null>(null);
  const [tab, setTab] = useState<ReportTab>("summary");
  const [leftTab, setLeftTab] = useState<LeftTab>("moments");
  const [exportOpen, setExportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContexts, setChatContexts] = useState<VideoChatContext[]>([REPORT_CHAT_CONTEXT.summary]);
  useEffect(() => {
    if (tab === "transcript" && !result?.transcript_text) {
      setTab("summary");
      setChatContexts([REPORT_CHAT_CONTEXT.summary]);
    }
  }, [tab, result?.transcript_text]);
  const [momentQuery, setMomentQuery] = useState("");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [transcriptSync, setTranscriptSync] = useState(true);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  // Indices still being written to the server, so the tick responds instantly without lying on failure.
  const [pendingActionItems, setPendingActionItems] = useState<Record<number, boolean>>({});
  const [addActionItemOpen, setAddActionItemOpen] = useState(false);
  const [actionItemDraft, setActionItemDraft] = useState("");
  const [actionItemSaving, setActionItemSaving] = useState(false);
  const [actionItemError, setActionItemError] = useState<string | null>(null);
  const playerRef = useRef<PlayerLike | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const momentSearchRef = useRef<HTMLInputElement | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const isPro = profile?.tier.toLowerCase() === "pro" && profile.subscription_status.toLowerCase() === "active";

  useEffect(() => {
    if (!isPro && leftTab !== "moments") {
      setLeftTab("moments");
      setChatContexts([LEFT_CHAT_CONTEXT.moments]);
    }
    if (!isPro && tab === "actionItems") {
      setTab("summary");
      setChatContexts([REPORT_CHAT_CONTEXT.summary]);
    }
  }, [isPro, leftTab, tab]);

  function selectReportTab(nextTab: ReportTab) {
    setTab(nextTab);
    setActiveChatSection(REPORT_CHAT_CONTEXT[nextTab]);
  }

  function selectLeftTab(nextTab: LeftTab) {
    setLeftTab(nextTab);
    setActiveChatSection(LEFT_CHAT_CONTEXT[nextTab]);
  }

  function setActiveChatSection(context: VideoChatContext) {
    setChatContexts((current) => [context, ...current.filter((item) => item.selected_text)].slice(0, MAX_CHAT_CONTEXTS));
  }

  function captureSelectedPageText() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim();
    if (!selection || !selectedText || selectedText.length < 2) {
      return;
    }
    const anchor = selection.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const region = element?.closest<HTMLElement>("[data-chat-context-id]");
    const contextId = region?.dataset.chatContextId;
    const label = region?.dataset.chatContextLabel;
    if (!contextId || !label) {
      return;
    }
    const nextContext = {
      context_id: contextId,
      label,
      selected_text: selectedText.slice(0, 1200),
    };
    setChatContexts((current) => {
      const duplicate = current.some(
        (item) => item.context_id === nextContext.context_id && item.selected_text === nextContext.selected_text,
      );
      if (duplicate || current.length >= MAX_CHAT_CONTEXTS) return current;
      return [...current, nextContext];
    });
  }

  async function refreshInsights() {
    setBusy(true);
    try {
      const [jobs, loadedProfile, loadedProjects] = await Promise.all([
        listJobs(50),
        getUserProfile().catch(() => null),
        listProjects().catch(() => []),
      ]);
      setProfile(loadedProfile);
      setProjects(loadedProjects);
      setHistory(jobs);
      if (requestedJobId) {
        const requested = jobs.find((job) => job.job_id === requestedJobId);
        setResult(requested ?? await getJob(requestedJobId).catch(() => null));
      } else {
        setResult((prev) => (prev ? jobs.find((job) => job.job_id === prev.job_id) ?? jobs[0] ?? null : jobs[0] ?? null));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRetryJob() {
    if (!result) return;
    setRetrying(true);
    setError(null);
    try {
      const queued = await retryJob(result.job_id);
      setResult(queued);
      window.location.href = `/workspace/analyzing?job=${queued.job_id}`;
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not retry this job.");
      setRetrying(false);
    }
  }

  useEffect(() => {
    void refreshInsights();
  }, [requestedJobId]);

  useEffect(() => {
    let cancelled = false;
    setShares([]);
    if (!result?.is_owner) {
      return;
    }
    void listJobShares(result.job_id)
      .then((loaded) => { if (!cancelled) setShares(loaded); })
      .catch(() => { if (!cancelled) setShares([]); });
    return () => { cancelled = true; };
  }, [result?.job_id, result?.is_owner]);

  async function onAssignProject(projectId: string) {
    if (!result) return;
    try {
      const updated = await assignJobProject(result.job_id, projectId || null);
      setResult(updated);
      setHistory((current) => current.map((job) => job.job_id === updated.job_id ? updated : job));
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Could not update project.");
    }
  }

  async function onShare() {
    if (!result || !shareEmail.trim()) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const added = await addJobShare(result.job_id, shareEmail.trim());
      setShares((current) => current.some((item) => item.user_id === added.user_id) ? current : [...current, added]);
      setShareEmail("");
    } catch (shareFailure) {
      setShareError(shareFailure instanceof Error ? shareFailure.message : "Could not share this note.");
    } finally {
      setShareBusy(false);
    }
  }

  async function onRemoveShare(userId: string) {
    if (!result) return;
    try {
      await removeJobShare(result.job_id, userId);
      setShares((current) => current.filter((item) => item.user_id !== userId));
    } catch (shareFailure) {
      setShareError(shareFailure instanceof Error ? shareFailure.message : "Could not remove access.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    setClips([]);
    setClipOpen(false);
    setEditNotesOpen(false);
    if (!result) return;
    void listJobClips(result.job_id)
      .then((loaded) => { if (!cancelled) setClips(loaded); })
      .catch(() => { if (!cancelled) setClips([]); });
    return () => { cancelled = true; };
  }, [result?.job_id]);

  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLeftTab("moments");
        momentSearchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onSearchShortcut);
    return () => window.removeEventListener("keydown", onSearchShortcut);
  }, []);

  function openNotesEditor() {
    if (!result) return;
    setEditSummary(result.summary);
    setEditDecisions((result.analysis?.decisions ?? []).join("\n"));
    setEditActionItems([...(result.analysis?.action_items ?? []), ...(result.custom_action_items ?? [])].join("\n"));
    setEditNotesError(null);
    setEditNotesOpen(true);
    setTab("summary");
  }

  async function saveNotes() {
    if (!result) return;
    setEditNotesBusy(true);
    setEditNotesError(null);
    try {
      const updated = await updateJobNotes(result.job_id, {
        summary: editSummary.trim(),
        decisions: editDecisions.split("\n").map((item) => item.trim()).filter(Boolean),
        action_items: editActionItems.split("\n").map((item) => item.trim()).filter(Boolean),
      });
      setResult(updated);
      setHistory((current) => current.map((job) => job.job_id === updated.job_id ? updated : job));
      setEditNotesOpen(false);
    } catch (saveError) {
      setEditNotesError(saveError instanceof Error ? saveError.message : "Could not save notes.");
    } finally {
      setEditNotesBusy(false);
    }
  }

  function openClipEditor() {
    const current = result?.youtube_video_id ? playerRef.current?.getCurrentTime() ?? playbackSeconds : videoRef.current?.currentTime ?? playbackSeconds;
    const duration = result?.duration_seconds;
    const start = Math.max(0, Math.min(Math.floor(current), duration ? duration - 1 : Number.MAX_SAFE_INTEGER));
    setClipStart(start);
    setClipEnd(duration ? Math.max(start + 1, Math.min(start + 30, duration)) : start + 30);
    setClipTitle("");
    setClipError(null);
    setClipOpen(true);
  }

  async function saveClip() {
    if (!result) return;
    setClipBusy(true);
    setClipError(null);
    try {
      const clip = await createJobClip(result.job_id, { title: clipTitle.trim(), start_seconds: clipStart, end_seconds: clipEnd });
      setClips((current) => [...current, clip].sort((a, b) => a.start_seconds - b.start_seconds));
      setClipOpen(false);
    } catch (saveError) {
      setClipError(saveError instanceof Error ? saveError.message : "Could not save clip.");
    } finally {
      setClipBusy(false);
    }
  }

  async function removeClip(clipId: string) {
    if (!result) return;
    try {
      await deleteJobClip(result.job_id, clipId);
      setClips((current) => current.filter((clip) => clip.clip_id !== clipId));
    } catch (removeError) {
      setClipError(removeError instanceof Error ? removeError.message : "Could not remove clip.");
    }
  }

  useEffect(() => {
    if (!result || (result.status !== "queued" && result.status !== "processing")) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const latest = await getJob(result.job_id);
        setResult(latest);
      } catch {
        // Ignore transient polling failures.
      }
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    if (!isPro || !result || result.status !== "completed") {
      setDetailedMoments([]);
      setDetailedMomentsError(null);
      setDetailedMomentsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setDetailedMoments([]);
    setDetailedMomentsError(null);
    setDetailedMomentsLoading(true);
    void getDetailedKeyMoments(result.job_id)
      .then((response) => {
        if (!cancelled) {
          setDetailedMoments(response.items);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetailedMomentsError(
            loadError instanceof Error ? loadError.message : "Failed to load detailed key moments."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailedMomentsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPro, result?.job_id, result?.status]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // react-youtube has no timeupdate event, so poll the player for the native <video> equivalent.
  useEffect(() => {
    if (!result?.youtube_video_id) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const current = playerRef.current?.getCurrentTime();
      if (typeof current === "number" && Number.isFinite(current)) {
        setPlaybackSeconds(current);
      }
    }, 400);
    return () => window.clearInterval(intervalId);
  }, [result?.youtube_video_id]);

  async function onGeneratePdf() {
    if (!result) {
      return;
    }

    setExportOpen(false);
    setBusy(true);
    setError(null);
    try {
      const generated = await generatePdf(result.job_id);
      setResult({ ...result, pdf_url: generated.pdf_url });
      const latestHistory = await listJobs(50);
      setHistory(latestHistory);
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : "Failed to generate PDF.");
    } finally {
      setBusy(false);
    }
  }

  function seekToSeconds(seconds: number) {
    setActiveTimestamp(seconds);
    setPlaybackSeconds(seconds);
    if (result?.youtube_video_id) {
      playerRef.current?.seekTo(seconds, true);
    } else if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      void videoRef.current.play();
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function jumpTo(point: KeyPoint) {
    seekToSeconds(point.timestamp_seconds);
  }

  async function submitCustomActionItem() {
    if (!result) {
      return;
    }
    const text = actionItemDraft.trim();
    if (!text) {
      return;
    }
    setActionItemSaving(true);
    setActionItemError(null);
    try {
      const updated = await addJobActionItem(result.job_id, text);
      setResult(updated);
      setHistory((prev) => prev.map((job) => (job.job_id === updated.job_id ? updated : job)));
      setActionItemDraft("");
      setAddActionItemOpen(false);
    } catch (submitError) {
      setActionItemError(submitError instanceof Error ? submitError.message : "Failed to add action item.");
    } finally {
      setActionItemSaving(false);
    }
  }

  async function toggleActionItem(index: number, completed: boolean) {
    if (!result) {
      return;
    }
    setPendingActionItems((prev) => ({ ...prev, [index]: completed }));
    try {
      const updated = await setJobActionItemCompleted(result.job_id, index, completed);
      setResult(updated);
      setHistory((prev) => prev.map((job) => (job.job_id === updated.job_id ? updated : job)));
    } catch {
      // Leave the server state as the source of truth; dropping the optimistic value reverts the tick.
    } finally {
      setPendingActionItems((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  }

  async function copySummary() {
    if (!result) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.summary);
    } catch {
      // Clipboard access can be blocked; silently ignore.
    }
  }

  const keyPoints = useMemo(() => [...(result?.key_points ?? [])].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds), [result]);
  const momentTimestamps = useMemo(
    () =>
      isPro && detailedMoments.length
        ? detailedMoments.map((moment) => moment.frame_timestamp_seconds)
        : keyPoints.map((point) => point.timestamp_seconds),
    [detailedMoments, isPro, keyPoints]
  );

  const allActionItems = useMemo(
    () => [...(result?.analysis?.action_items ?? []), ...(result?.custom_action_items ?? [])],
    [result]
  );

  const speakerAirtime = result?.speaker_airtime ?? [];
  const totalAirtimeSeconds = speakerAirtime.reduce((sum, entry) => sum + entry.seconds, 0);
  const discussionLabel = (() => {
    if (!speakerAirtime.length) {
      return "No data";
    }
    const topPercent = speakerAirtime[0].percent;
    if (speakerAirtime.length === 1) {
      return "Monologue";
    }
    if (topPercent >= 60) {
      return `${speakerAirtime[0].speaker.split(" ")[0]} Led`;
    }
    return "Balanced Discussion";
  })();

  const filteredPoints = useMemo(() => {
    const query = momentQuery.trim().toLowerCase();
    if (!query) {
      return keyPoints;
    }
    return keyPoints.filter((point) => `${point.title} ${point.description}`.toLowerCase().includes(query));
  }, [keyPoints, momentQuery]);

  const transcriptMatchCount = useMemo(() => {
    const trimmed = transcriptQuery.trim();
    if (!trimmed || !result?.transcript_text) {
      return 0;
    }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (result.transcript_text.match(new RegExp(escaped, "gi")) ?? []).length;
  }, [result?.transcript_text, transcriptQuery]);

  const transcriptSegments = useMemo(() => result?.transcript_segments ?? [], [result]);
  const transcriptSearchResults = useMemo(() => {
    const query = momentQuery.trim().toLowerCase();
    if (!query) return [];
    return transcriptSegments
      .filter((segment) => segment.text.toLowerCase().includes(query))
      .slice(0, 20);
  }, [momentQuery, transcriptSegments]);
  const rawTranscriptMatch = momentQuery.trim() && transcriptSegments.length === 0 && result?.transcript_text?.toLowerCase().includes(momentQuery.trim().toLowerCase());

  // Reuses the Speaker Airtime card's palette/order so the same person has the same color everywhere.
  const speakerColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    speakerAirtime.forEach((entry, index) => map.set(entry.speaker, index));
    let next = speakerAirtime.length;
    transcriptSegments.forEach((segment) => {
      if (segment.speaker && !map.has(segment.speaker)) {
        map.set(segment.speaker, next++);
      }
    });
    return map;
  }, [speakerAirtime, transcriptSegments]);

  const activeSegmentIndex = useMemo(() => {
    if (!transcriptSegments.length) {
      return -1;
    }
    let index = -1;
    for (let i = 0; i < transcriptSegments.length; i += 1) {
      if (transcriptSegments[i].start <= playbackSeconds + 0.15) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [transcriptSegments, playbackSeconds]);

  useEffect(() => {
    if (!transcriptSync || tab !== "transcript" || activeSegmentIndex < 0) {
      return;
    }
    const container = transcriptListRef.current;
    const segment = segmentRefs.current[activeSegmentIndex];
    if (!container || !segment) {
      return;
    }
    // Scroll only the transcript list itself; scrollIntoView would also center the page.
    // offsetTop isn't reliable here since the container isn't segment's offsetParent, so
    // compute the offset from live rects instead.
    const containerRect = container.getBoundingClientRect();
    const segmentRect = segment.getBoundingClientRect();
    const target =
      container.scrollTop + (segmentRect.top - containerRect.top) - container.clientHeight / 2 + segmentRect.height / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeSegmentIndex, transcriptSync, tab]);

  const spanSeconds = keyPoints.length ? keyPoints[keyPoints.length - 1].timestamp_seconds : 0;
  const status = result?.status ?? "queued";
  const statusMeta = STATUS_META[status];
  const title = jobTitle(result);
  const sidebarPad = collapsed ? "lg:pl-20" : "lg:pl-64";

  const titleBlock = (
    <>
      <h1 className="font-display text-[32px] font-bold leading-10 tracking-tight text-core-on-surface break-words">{title}</h1>
      <div className="flex flex-wrap items-center gap-2.5">
        {result?.is_owner ? (
          <label className="flex items-center gap-2 text-xs font-medium text-core-on-surface-variant">
            Project
            <select aria-label="Project for this note" value={result.project_id ?? ""} onChange={(event) => void onAssignProject(event.target.value)} className="rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest px-2 py-1 text-core-on-surface">
              <option value="">No project</option>
              {projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}
            </select>
          </label>
        ) : null}
        <span className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2.5 py-1 text-[13px] text-core-on-surface-variant shadow-sm">
          <Icon name={result ? jobSourceIcon(result) : "movie"} className="!text-[16px] text-core-outline" />
          {result ? jobSourceLabel(result) : "Uploaded video"}
        </span>
        {result ? (
          <span className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2.5 py-1 text-[13px] text-core-on-surface-variant shadow-sm">
            <Icon name="calendar_today" className="!text-[16px] text-core-outline" />
            Recorded {formatRecordedDate(result.created_at)}
          </span>
        ) : null}
        <span className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2.5 py-1 text-[13px] text-core-on-surface-variant shadow-sm">
          <Icon name="schedule" className="!text-[16px] text-core-outline" />
          <span className="font-jetbrains-mono text-[12px] font-semibold">{spanSeconds ? `${toClock(spanSeconds)} covered` : "No timeline"}</span>
        </span>
        <span className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2.5 py-1 text-[13px] text-core-on-surface-variant shadow-sm">
          <Icon name="photo_library" className="!text-[16px] text-core-outline" />
          {keyPoints.length} key moments
        </span>
        {result?.analysis?.participants.count ? (
          <span className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2.5 py-1 text-[13px] text-core-on-surface-variant shadow-sm">
            <Icon name="group" className="!text-[16px] text-core-outline" />
            {result.analysis.participants.count} participants
          </span>
        ) : null}
        {status === "completed" ? (
          <span className="flex items-center gap-1.5 rounded-lg bg-core-surface-container-high px-3 py-1 text-[13px] font-medium text-core-primary">
            <Icon name="verified" className="!text-[16px]" />
            Verified summary
          </span>
        ) : null}
      </div>
    </>
  );

  const actionsBar = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:justify-end">
      <span
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-jetbrains-mono text-[11px] font-semibold uppercase tracking-[0.05em] ${statusMeta.chip}`}
      >
        <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} />
        {statusMeta.label}
      </span>
      {result?.is_owner && result.status === "completed" ? (
        <button type="button" onClick={openNotesEditor} className="flex h-8 items-center gap-1.5 rounded-lg bg-core-surface-container-lowest px-3 text-[13px] font-semibold text-core-primary shadow-sm hover:bg-core-surface-container">
          <Icon name="edit_note" className="!text-[16px]" />Edit Notes
        </button>
      ) : null}
      {result?.is_owner ? (
        <div className="relative">
          <button type="button" onClick={() => setShareOpen((open) => !open)} className="flex h-8 items-center gap-1.5 rounded-lg bg-core-surface-container-lowest px-3 text-[13px] font-semibold text-core-primary shadow-sm hover:bg-core-surface-container">
            <Icon name="group_add" className="!text-[16px]" />Share
          </button>
          {shareOpen ? (
            <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-4 shadow-lg">
              <p className="mb-2 text-sm font-semibold text-core-on-surface">Share read access</p>
              <p className="mb-3 text-xs text-core-on-surface-variant">The person must already have a FrameNote account.</p>
              <form onSubmit={(event) => { event.preventDefault(); void onShare(); }} className="flex gap-2">
                <input type="email" aria-label="Collaborator email" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} placeholder="Email address" className="min-w-0 flex-1 rounded-lg border border-core-outline-variant/30 px-2 py-1.5 text-sm" />
                <button type="submit" disabled={shareBusy || !shareEmail.trim()} className="rounded-lg bg-core-primary px-3 text-xs font-semibold text-core-on-primary disabled:opacity-50">Add</button>
              </form>
              {shareError ? <p role="alert" className="mt-2 text-xs text-core-error">{shareError}</p> : null}
              {shares.length ? <ul className="mt-3 space-y-2">{shares.map((share) => <li key={share.user_id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate" title={share.email}>{share.email}</span><button type="button" onClick={() => void onRemoveShare(share.user_id)} className="font-semibold text-core-error">Remove</button></li>)}</ul> : <p className="mt-3 text-xs text-core-on-surface-variant">Only you can see this note.</p>}
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        disabled={status !== "completed" || !result?.transcript_text}
        title={result?.transcript_text ? "Ask questions grounded in this video's transcript" : "A completed transcript is required"}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-core-primary-fixed px-2.5 text-[13px] font-semibold text-core-primary shadow-sm transition-all hover:bg-core-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Icon name="auto_awesome" className="!text-[16px]" />
        Ask this video
      </button>
      <button
        type="button"
        onClick={() => void refreshInsights()}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-core-surface-container-lowest px-2.5 text-[13px] font-semibold text-core-on-surface shadow-sm transition-all hover:bg-core-surface-container"
      >
        <Icon name="refresh" className={`!text-[16px] text-core-primary ${busy ? "animate-spin" : ""}`} />
        {busy ? "Refreshing" : "Refresh"}
      </button>

      <div className="relative inline-block text-left" ref={exportRef}>
        <button
          type="button"
          onClick={() => setExportOpen((open) => !open)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-core-primary px-3 text-[13px] font-semibold text-core-on-primary shadow-sm transition-all hover:bg-core-surface-tint"
        >
          <Icon name="ios_share" className="!text-[16px]" />
          Export
          <Icon name="expand_more" className="!text-[14px]" />
        </button>

        {exportOpen ? (
          <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.1)]">
            {result?.is_owner ? <button
              type="button"
              onClick={() => void onGeneratePdf()}
              disabled={status !== "completed" || busy}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-core-on-surface transition-colors hover:bg-core-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="picture_as_pdf" className="!text-[18px] text-core-error" />
              Generate executive PDF
            </button> : null}
            {result?.pdf_url ? (
              <a
                href={result.pdf_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-core-on-surface transition-colors hover:bg-core-surface-container-high"
              >
                <Icon name="download" className="!text-[18px] text-core-primary" />
                Download latest PDF
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (result) downloadReportMarkdown(result);
                setExportOpen(false);
              }}
              disabled={status !== "completed" || !result}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-core-on-surface transition-colors hover:bg-core-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="description" className="!text-[18px] text-core-primary" />
              Download Markdown (.md)
            </button>
            <button
              type="button"
              onClick={() => void copySummary()}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-core-on-surface transition-colors hover:bg-core-surface-container-high"
            >
              <Icon name="content_copy" className="!text-[18px] text-core-outline" />
              Copy summary text
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${sidebarPad} ${chatOpen ? "xl:pr-[420px]" : ""}`}>
        <AppTopbar />

        <main
          onMouseUp={captureSelectedPageText}
          className="mx-auto w-full max-w-[1760px] px-4 pb-12 pt-6 sm:px-6 lg:px-8"
        >
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm text-core-on-surface-variant">
            <Link href="/workspace/history" className="flex items-center gap-1.5 font-medium transition-colors hover:text-core-primary">
              <Icon name="folder" className="!text-[18px]" />
              Projects
            </Link>
            <span className="text-core-outline-variant">/</span>
            <Link href={result?.project_id ? `/workspace/history?project=${result.project_id}` : "/workspace/history"} className="font-medium transition-colors hover:text-core-primary">{result?.project_name || "Unfiled"}</Link>
            <span className="text-core-outline-variant">/</span>
            <span className="max-w-[18rem] truncate font-semibold text-core-on-surface">{title}</span>
          </nav>

          {/* Title & primary actions render inside the content grid when a result exists. */}
          {!result ? (
            <div className="mt-3 grid grid-cols-1 items-start gap-4 pb-0 lg:grid-cols-12 lg:gap-8">
              <div className="min-w-0 space-y-2 lg:col-span-7">{titleBlock}</div>
              <div className="self-start lg:col-span-5">{actionsBar}</div>
            </div>
          ) : null}

          {error ? (
            <div className="mb-6 flex items-center gap-2 rounded-xl bg-state-danger-soft px-4 py-3 text-sm font-medium text-state-on-danger-soft">
              <Icon name="error" className="!text-[18px]" />
              {error}
            </div>
          ) : null}

          {!result ? (
            <SectionCard className="px-6 py-16 text-center">
              <Icon name="video_library" className="!text-[32px] text-core-outline" />
              <p className="mt-3 text-sm text-core-on-surface-variant">No notes available yet. Create a job to generate insights.</p>
              <Link
                href="/"
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-core-primary px-4 text-sm font-semibold text-core-on-primary"
              >
                <Icon name="add" className="!text-[18px]" />
                New note
              </Link>
            </SectionCard>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-start gap-6 lg:grid-cols-12 lg:gap-x-8">
              {/* TITLE (row 1, left column) */}
              <div className="order-1 min-w-0 space-y-2 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-1">
                {titleBlock}
              </div>

              {/* LEFT COLUMN */}
              <div className="order-4 flex min-w-0 flex-col gap-6 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-2">
                <SectionCard className="flex flex-col overflow-hidden !shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                  <div className="relative aspect-video w-full overflow-hidden bg-core-inverse-surface">
                    {result.youtube_video_id ? (
                      <YouTube
                        videoId={result.youtube_video_id}
                        opts={{ width: "100%", height: "100%", playerVars: { rel: 0, modestbranding: 1 } }}
                        className="h-full w-full"
                        iframeClassName="h-full w-full"
                        onReady={(event) => {
                          playerRef.current = event.target as PlayerLike;
                        }}
                      />
                    ) : result.video_url ? (
                      <video
                        key={result.video_url}
                        ref={videoRef}
                        src={result.video_url}
                        controls
                        playsInline
                        poster={keyPoints[0]?.frame_image_url ?? undefined}
                        className="h-full w-full bg-black"
                        onTimeUpdate={(event) => {
                          const current = event.currentTarget.currentTime;
                          setPlaybackSeconds(current);
                          const nearest = [...momentTimestamps].reverse().find((timestamp) => timestamp <= current + 0.5);
                          if (nearest !== undefined && nearest !== activeTimestamp) {
                            setActiveTimestamp(nearest);
                          }
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-core-inverse-surface text-core-inverse-on-surface">
                        {keyPoints[0]?.frame_image_url ? (
                          <img src={keyPoints[0].frame_image_url} alt="Primary frame" className="h-full w-full object-cover opacity-70" />
                        ) : (
                          <>
                            <Icon name="movie" className="!text-[32px]" />
                            <p className="text-sm opacity-80">Video preview unavailable for this source</p>
                          </>
                        )}
                      </div>
                    )}
                    <span className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded-md bg-core-inverse-surface/80 px-2.5 py-1 font-jetbrains-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-core-inverse-on-surface backdrop-blur-md">
                      <span className={`h-2 w-2 rounded-full ${status === "completed" ? "bg-state-success" : "bg-core-error"}`} />
                      {result.source_type === "upload" ? "Uploaded recording" : "Streaming source"}
                    </span>
                  </div>
                </SectionCard>

                <SectionCard className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-core-on-surface">Saved clips</h2>
                      <p className="text-xs text-core-on-surface-variant">Bookmark useful parts of this recording.</p>
                    </div>
                    {result.is_owner && result.status === "completed" ? <button type="button" onClick={openClipEditor} className="rounded-lg bg-core-primary-fixed px-3 py-1.5 text-xs font-semibold text-core-primary">Add Clip</button> : null}
                  </div>
                  {clipOpen ? (
                    <div className="space-y-2 rounded-xl bg-core-surface-container-low p-3">
                      <input aria-label="Clip title" value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} maxLength={120} placeholder="Clip title" className="w-full rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest px-3 py-2 text-sm" />
                      <div className="flex items-center gap-2 text-xs text-core-on-surface-variant">
                        <label>Start (seconds)<input type="number" min={0} value={clipStart} onChange={(event) => setClipStart(Number(event.target.value))} className="ml-1 w-20 rounded-lg border px-2 py-1" /></label>
                        <label>End (seconds)<input type="number" min={1} value={clipEnd} onChange={(event) => setClipEnd(Number(event.target.value))} className="ml-1 w-20 rounded-lg border px-2 py-1" /></label>
                      </div>
                      {clipError ? <p role="alert" className="text-xs text-core-error">{clipError}</p> : null}
                      <div className="flex gap-2"><button type="button" onClick={() => setClipOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold">Cancel</button><button type="button" onClick={() => void saveClip()} disabled={clipBusy || !clipTitle.trim() || !Number.isInteger(clipStart) || !Number.isInteger(clipEnd) || clipStart < 0 || clipEnd <= clipStart} className="rounded-lg bg-core-primary px-3 py-1.5 text-xs font-semibold text-core-on-primary disabled:opacity-50">{clipBusy ? "Saving…" : "Save clip"}</button></div>
                    </div>
                  ) : clipError ? <p role="alert" className="text-xs text-core-error">{clipError}</p> : null}
                  {clips.length ? <ul className="space-y-1">{clips.map((clip) => <li key={clip.clip_id} className="flex items-center gap-2 rounded-lg bg-core-surface-container-low px-3 py-2 text-xs"><button type="button" onClick={() => seekToSeconds(clip.start_seconds)} className="min-w-0 flex-1 truncate text-left font-semibold text-core-primary" title={`Play from ${toClock(clip.start_seconds)}`}>{toClock(clip.start_seconds)}–{toClock(clip.end_seconds)} · {clip.title}</button>{result.is_owner ? <button type="button" onClick={() => void removeClip(clip.clip_id)} aria-label={`Remove ${clip.title}`} className="font-semibold text-core-error">Remove</button> : null}</li>)}</ul> : <p className="text-xs text-core-on-surface-variant">No clips saved yet.</p>}
                </SectionCard>

                {/* KPI scorecard */}
                <div className="flex flex-col gap-4 sm:flex-row">
                  <KpiCard label="Read time" value={`~${readMinutes(result)} min`} caption="Versus full video playback" icon="hourglass_top" />
                  <KpiCard label="Key moments" value={`${keyPoints.length} frames`} caption="Captured and timestamped" icon="check_circle" />
                  {isPro ? (
                    <KpiCard
                      label="Action items"
                      value={`${result.analysis?.action_items.length ?? 0} tasks`}
                      caption="Captured from discussion"
                      icon="task_alt"
                    />
                  ) : (
                    <KpiCard label="Detailed notes" value="Pro feature" caption="Timeline, Q&A and action items" icon="lock" />
                  )}
                  <KpiCard
                    label="Sentiment"
                    value={result.sentiment ?? "Neutral"}
                    caption={SENTIMENT_META[result.sentiment ?? "Neutral"].caption}
                    icon={SENTIMENT_META[result.sentiment ?? "Neutral"].icon}
                    iconClassName={SENTIMENT_META[result.sentiment ?? "Neutral"].iconClass}
                  />
                </div>

                {/* Notes navigation */}
                <div className="flex items-center gap-1 overflow-x-auto rounded-2xl bg-core-surface-container p-1 shadow-inner">
                  {(
                    isPro
                      ? [
                          { id: "speakers" as const, label: "Speakers & participants", icon: "group" },
                          { id: "detailed" as const, label: "Full Detailed Notes", icon: "fact_check" },
                          { id: "moments" as const, label: "Key Moments", icon: "photo_library" },
                        ]
                      : [{ id: "moments" as const, label: "Key Moments", icon: "photo_library" }]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectLeftTab(item.id)}
                      className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                        leftTab === item.id
                          ? "bg-core-surface-container-lowest text-core-primary shadow-sm"
                          : "text-core-on-surface-variant hover:bg-core-surface-container-high"
                      }`}
                    >
                      <Icon name={item.icon} className="!text-[18px]" />
                      {item.label}
                      {item.id === "moments" ? (
                        <span className="rounded-full bg-core-primary-fixed px-1.5 py-0.5 font-jetbrains-mono text-[9px] font-bold uppercase tracking-[0.04em] text-core-primary">
                          {isPro ? "Enhanced" : "Standard"}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {!isPro ? (
                    <Link href="/upgrade" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[12px] font-semibold text-core-primary hover:bg-core-primary-fixed">
                      <Icon name="lock" className="!text-[15px]" />
                      Detailed notes with Pro
                    </Link>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-3">
                  <label className="flex items-center gap-2">
                    <Icon name="search" className="!text-[18px] text-core-outline" />
                    <input ref={momentSearchRef} type="search" value={momentQuery} onChange={(event) => setMomentQuery(event.target.value)} placeholder="Search moments and transcript" aria-label="Search moments and transcript" className="min-w-0 flex-1 bg-transparent text-sm text-core-on-surface outline-none" />
                    <span className="rounded border border-core-outline-variant/30 px-1.5 py-0.5 text-[10px] text-core-outline">⌘K</span>
                  </label>
                  {momentQuery.trim() ? (
                    <div className="mt-3 border-t border-core-outline-variant/20 pt-3">
                      <p className="mb-2 text-xs font-semibold text-core-on-surface-variant">Transcript matches</p>
                      {transcriptSearchResults.length ? <ul className="max-h-52 space-y-1 overflow-y-auto">{transcriptSearchResults.map((segment, index) => <li key={`${segment.start}-${index}`}><button type="button" onClick={() => seekToSeconds(segment.start)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-core-surface-container-low"><span className="mr-2 font-semibold text-core-primary">{toClock(segment.start)}</span>{highlightMatches(segmentDialogue(segment), momentQuery)}</button></li>)}</ul> : rawTranscriptMatch ? <p className="text-xs text-core-on-surface-variant">Found in the transcript. Open Raw Transcript to read the match; timestamps are unavailable for this recording.</p> : <p className="text-xs text-core-on-surface-variant">No transcript matches.</p>}
                    </div>
                  ) : null}
                </div>

                <TabScrollArea context={LEFT_CHAT_CONTEXT[leftTab]}>
                  {/* Speakers & participants tab */}
                  {leftTab === "speakers" && isPro && result.analysis?.participants ? (
                  <SectionCard className="flex flex-col gap-3 p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                          <Icon name="group" className="!text-[20px]" />
                        </div>
                        <div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Speakers & participants</h3>
                          <p className="text-[13px] text-core-on-surface-variant">
                            {result.analysis.participants.count > 0
                              ? `Detected via ${result.analysis.participants.source}`
                              : "Not detected in this recording"}
                          </p>
                        </div>
                      </div>
                      {result.analysis.participants.count > 0 ? (
                        <span className="flex items-center gap-1.5 self-start rounded-full bg-core-primary-fixed px-3 py-1 font-jetbrains-mono text-[11px] font-bold uppercase tracking-[0.05em] text-core-primary sm:self-auto">
                          <Icon name="groups" className="!text-[14px]" />
                          {result.analysis.participants.count} on this call
                        </span>
                      ) : null}
                    </div>
                    {result.analysis.participants.names.length ? (
                      <div className="flex flex-wrap gap-2">
                        {result.analysis.participants.names.map((name, index) => (
                          <span
                            key={`participant-${index}`}
                            className="rounded-full bg-core-surface-container-low px-3 py-1.5 text-[13px] font-medium text-core-on-surface"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {!(result.speaker_airtime ?? []).length && !result.analysis.participants.names.length ? (
                      <p className="text-sm text-core-on-surface-variant">
                        Per-speaker airtime breakdown isn&apos;t available yet — it requires voice diarization, which
                        hasn&apos;t been enabled for this workspace.
                      </p>
                    ) : null}
                  </SectionCard>
                  ) : null}

                  {/* Speaker Airtime card */}
                  {leftTab === "speakers" && isPro && (result.speaker_airtime ?? []).length > 0 ? (
                  <SectionCard className="flex flex-col gap-5 p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                          <Icon name="groups" className="!text-[20px]" />
                        </div>
                        <div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Speaker Airtime</h3>
                          <p className="text-[13px] text-core-on-surface-variant">
                            Total meeting duration {toClock(totalAirtimeSeconds)} •{" "}
                            {speakerAirtime.length} speaker{speakerAirtime.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5 self-start rounded-full bg-core-primary-fixed px-3 py-1 font-jetbrains-mono text-[11px] font-bold text-core-primary sm:self-auto">
                        {discussionLabel}
                      </span>
                    </div>

                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-core-surface-container-low">
                      {speakerAirtime.map((entry, index) => (
                        <div
                          key={`bar-${entry.speaker}`}
                          className={SPEAKER_COLORS[index % SPEAKER_COLORS.length].bar}
                          style={{ width: `${Math.max(0, Math.min(100, entry.percent))}%` }}
                        />
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      {speakerAirtime.map((entry, index) => (
                        <span key={`legend-${entry.speaker}`} className="flex items-center gap-1.5 text-[13px]">
                          <span className={`h-2.5 w-2.5 rounded-full ${SPEAKER_COLORS[index % SPEAKER_COLORS.length].dot}`} />
                          <span className="font-semibold text-core-on-surface">{entry.speaker}</span>
                          <span className="text-core-on-surface-variant">
                            {entry.percent}% ({toClock(entry.seconds)})
                          </span>
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-col divide-y divide-core-outline-variant/15">
                      {speakerAirtime.map((entry, index) => {
                        const color = SPEAKER_COLORS[index % SPEAKER_COLORS.length];
                        const turnTimestamps = entry.turn_start_seconds ?? [];
                        const shownTimestamps = turnTimestamps.slice(0, 3);
                        const remainingTurns = (entry.turns ?? turnTimestamps.length) - shownTimestamps.length;
                        return (
                          <div
                            key={`speaker-card-${entry.speaker}`}
                            className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold ${color.avatarBg} ${color.avatarText}`}
                              >
                                {speakerInitials(entry.speaker)}
                              </span>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-[15px] font-bold text-core-on-surface">{entry.speaker}</h4>
                                  {entry.turns ? (
                                    <span className="rounded-full bg-core-primary-fixed px-2 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-primary">
                                      {entry.turns} turn{entry.turns === 1 ? "" : "s"}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[13px] text-core-on-surface-variant">
                                  {toClock(entry.seconds)} • {entry.percent}% of airtime
                                </p>
                              </div>
                            </div>
                            {shownTimestamps.length ? (
                              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                                <span className="text-[12px] font-semibold text-core-on-surface-variant">Jump:</span>
                                {shownTimestamps.map((seconds, chipIndex) => (
                                  <button
                                    key={`jump-${entry.speaker}-${chipIndex}`}
                                    type="button"
                                    onClick={() => seekToSeconds(seconds)}
                                    className="flex items-center gap-1 rounded-lg bg-core-surface-container-low px-2 py-1 font-jetbrains-mono text-[12px] font-semibold text-core-primary transition-colors hover:bg-core-primary hover:text-core-on-primary"
                                  >
                                    <Icon name="play_arrow" className="!text-[13px]" />
                                    {toClock(seconds)}
                                  </button>
                                ))}
                                {remainingTurns > 0 ? (
                                  <span className="rounded-lg bg-core-surface-container-low px-2 py-1 text-[12px] font-semibold text-core-on-surface-variant">
                                    +{remainingTurns} turn{remainingTurns === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                  ) : null}

                  {/* Full Detailed Notes tab */}
                  {leftTab === "detailed" && isPro ? (
                  <div className="flex flex-col gap-6">
                    {/* Strategic themes & key discussion topics */}
                    {result.analysis?.timeline.length ? (
                      <SectionCard className="flex flex-col gap-4 p-6">
                        <div className="flex items-center gap-2.5 border-b border-core-outline-variant/20 pb-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                            <Icon name="route" className="!text-[20px]" />
                          </div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Strategic themes & key discussion topics</h3>
                        </div>
                        <ol className="space-y-4">
                          {result.analysis.timeline.map((section, index) => (
                            <li key={`theme-${index}`} className="rounded-xl bg-core-surface-container-low p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-core-primary px-2 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-on-primary">
                                  {toClock(section.start_seconds)}–{toClock(section.end_seconds)}
                                </span>
                                <h4 className="text-[15px] font-bold text-core-on-surface">
                                  {index + 1}. {section.title}
                                </h4>
                              </div>
                              <ul className="mt-2 space-y-1.5 pl-1">
                                {section.bullets.map((bullet, bulletIndex) => (
                                  <li key={`theme-${index}-bullet-${bulletIndex}`} className="flex items-start gap-2 text-sm text-core-on-surface-variant">
                                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-core-outline" />
                                    {bullet}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ol>
                      </SectionCard>
                    ) : null}

                    {/* Open questions & answers */}
                    {result.analysis?.questions_and_answers.length ? (
                      <SectionCard className="flex flex-col gap-4 p-6">
                        <div className="flex items-center gap-2.5 border-b border-core-outline-variant/20 pb-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                            <Icon name="help" className="!text-[20px]" />
                          </div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Open questions & answers</h3>
                        </div>
                        <ul className="space-y-3">
                          {result.analysis.questions_and_answers.map((qa, index) => (
                            <li key={`qa-${index}`} className="rounded-xl bg-core-surface-container-low p-4">
                              <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-core-outline">
                                <span className="rounded bg-core-surface-container px-2 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-primary">
                                  {toClock(qa.time_seconds)}
                                </span>
                                {qa.asked_by}
                              </div>
                              <p className="mt-1.5 text-sm font-semibold text-core-on-surface">{qa.question}</p>
                              {qa.answer ? <p className="mt-1 text-sm text-core-on-surface-variant">{qa.answer}</p> : null}
                            </li>
                          ))}
                        </ul>
                      </SectionCard>
                    ) : null}

                    {!result.analysis ||
                    (!result.analysis.timeline.length && !result.analysis.questions_and_answers.length) ? (
                      <SectionCard className="px-6 py-10 text-center">
                        <Icon name="fact_check" className="!text-[28px] text-core-outline" />
                        <p className="mt-3 text-sm text-core-on-surface-variant">
                          Detailed themes and Q&amp;A will appear here once processing completes.
                        </p>
                      </SectionCard>
                    ) : null}
                  </div>
                  ) : null}

                  {/* Key Moments tab */}
                  {leftTab === "moments" && isPro ? (
                  <DetailedKeyMoments
                    moments={detailedMoments}
                    loading={detailedMomentsLoading}
                    error={detailedMomentsError}
                    query={momentQuery}
                    activeTimestamp={activeTimestamp}
                    onJump={seekToSeconds}
                  />
                ) : leftTab === "moments" ? (
                  <SectionCard className="flex flex-col gap-6 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-core-outline-variant/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                          <Icon name="photo_library" className="!text-[20px]" />
                        </div>
                        <div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Key moments & slide captures</h3>
                          <p className="text-[13px] text-core-on-surface-variant">Synchronized visual frames and takeaways</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-core-surface-container-high px-2.5 py-1 font-jetbrains-mono text-[11px] font-semibold text-core-primary">
                        {filteredPoints.length} key frames
                      </span>
                    </div>

                    {filteredPoints.length === 0 ? (
                      <p className="py-6 text-center text-sm text-core-on-surface-variant">No moments match this search.</p>
                    ) : (
                      <div className="space-y-6">
                        {filteredPoints.map((point) => (
                          <div
                            key={`${point.title}-${point.timestamp_seconds}`}
                            className={`flex flex-col gap-3.5 rounded-xl p-4 transition-all ${
                              activeTimestamp === point.timestamp_seconds
                                ? "bg-core-surface-container ring-1 ring-core-primary/30"
                                : "bg-core-surface-container-low hover:bg-core-surface-container"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-md bg-core-primary px-2.5 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-on-primary">
                                    {toClock(point.timestamp_seconds)}
                                  </span>
                                  <h4 className="text-[15px] font-bold text-core-on-surface">{point.title}</h4>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => jumpTo(point)}
                                className="flex h-8 items-center gap-1.5 rounded-lg bg-core-surface-container-lowest px-2.5 text-[12px] font-semibold text-core-primary shadow-sm transition-all hover:bg-core-primary hover:text-core-on-primary"
                              >
                                <Icon name="play_arrow" className="!text-[16px]" />
                                Jump to frame
                              </button>
                            </div>

                            {point.frame_image_url ? (
                              <img
                                src={point.frame_image_url}
                                alt={`Frame for ${point.title}`}
                                loading="lazy"
                                className="w-full rounded-lg border border-core-outline-variant/25 object-cover"
                              />
                            ) : null}

                            <p className="text-sm leading-relaxed text-core-on-surface-variant">{point.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                  ) : null}
                </TabScrollArea>

              </div>

              {/* RIGHT HEADER (row 1) — shares row 1 with the title so the panel below lines up with the video card. */}
              <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-1">
                {actionsBar}
                <div className="flex items-center gap-1 overflow-x-auto rounded-2xl bg-core-surface-container p-1 shadow-inner">
                  {(
                    [
                      { id: "summary" as const, label: "Summary", icon: "auto_awesome" },
                      { id: "moments" as const, label: "Highlights", icon: "checklist" },
                      { id: "chapters" as const, label: "Chapters", icon: "bookmarks" },
                      ...(isPro ? [{ id: "actionItems" as const, label: "Action items", icon: "task_alt" }] : []),
                      ...(result?.transcript_text
                        ? [{ id: "transcript" as const, label: "Raw Transcript", icon: "subject" }]
                        : []),
                    ]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectReportTab(item.id)}
                      className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                        tab === item.id
                          ? "bg-core-surface-container-lowest text-core-primary shadow-sm"
                          : "text-core-on-surface-variant hover:bg-core-surface-container-high"
                      }`}
                    >
                      <Icon name={item.icon} className="!text-[18px]" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* RIGHT COLUMN */}
              <div className="order-3 flex min-w-0 flex-col gap-6 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-2">
                <TabScrollArea context={REPORT_CHAT_CONTEXT[tab]}>
                  {tab === "summary" && editNotesOpen ? (
                    <SectionCard className="space-y-4 p-6">
                      <div><h2 className="text-lg font-bold text-core-on-surface">Edit notes</h2><p className="text-xs text-core-on-surface-variant">Put each decision and action item on its own line. Saving clears completed checkmarks and requires a new PDF export.</p></div>
                      <label className="block text-xs font-semibold text-core-on-surface">Summary<textarea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} rows={6} maxLength={20000} className="mt-1 w-full rounded-xl border border-core-outline-variant/30 bg-core-surface-container-lowest p-3 text-sm font-normal" /></label>
                      <label className="block text-xs font-semibold text-core-on-surface">Decisions<textarea value={editDecisions} onChange={(event) => setEditDecisions(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-core-outline-variant/30 bg-core-surface-container-lowest p-3 text-sm font-normal" /></label>
                      <label className="block text-xs font-semibold text-core-on-surface">Action items<textarea value={editActionItems} onChange={(event) => setEditActionItems(event.target.value)} rows={5} className="mt-1 w-full rounded-xl border border-core-outline-variant/30 bg-core-surface-container-lowest p-3 text-sm font-normal" /></label>
                      {editNotesError ? <p role="alert" className="text-xs text-core-error">{editNotesError}</p> : null}
                      <div className="flex gap-2"><button type="button" onClick={() => setEditNotesOpen(false)} className="rounded-lg px-4 py-2 text-sm font-semibold text-core-on-surface">Cancel</button><button type="button" onClick={() => void saveNotes()} disabled={editNotesBusy || !editSummary.trim()} className="rounded-lg bg-core-primary px-4 py-2 text-sm font-semibold text-core-on-primary disabled:opacity-50">{editNotesBusy ? "Saving…" : "Save notes"}</button></div>
                    </SectionCard>
                  ) : null}
                  {tab === "summary" && !editNotesOpen ? (
                  <SectionCard className="flex flex-col gap-5 p-6">
                    <div className="flex flex-col justify-between gap-4 border-b border-core-outline-variant/20 pb-4 lg:flex-row lg:items-center">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-core-primary text-core-on-primary shadow-sm">
                          <Icon name="description" className="!text-[20px]" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2.5">
                            <h3 className="font-display text-[18px] font-bold text-core-on-surface">AI generated notes</h3>
                            <span className="flex items-center gap-1 rounded-full bg-core-primary-fixed px-2.5 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-primary">
                              <Icon name="auto_awesome" className="!text-[14px]" />
                              Synthesized
                            </span>
                          </div>
                          <p className="mt-0.5 text-[13px] text-core-on-surface-variant">Transcript distillation with timestamped deliverables</p>
                          {result.summary_model || result.transcription_model ? (
                            <p className="mt-1 text-[11px] text-core-on-surface-variant">
                              {result.transcription_model ? `Transcript: ${result.transcription_model}` : ""}
                              {result.transcription_model && result.summary_model ? " · " : ""}
                              {result.summary_model ? `Summary: ${result.summary_model}` : ""}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void copySummary()}
                        className="flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg bg-core-surface-container-low px-3 text-[12px] font-semibold text-core-on-surface shadow-sm transition-all hover:bg-core-surface-container lg:self-center"
                      >
                        <Icon name="content_copy" className="!text-[15px] text-core-outline" />
                        Copy
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 rounded-xl border border-core-outline-variant/20 bg-core-surface-container-low p-4">
                      <span className="flex items-center gap-1.5 font-jetbrains-mono text-[11px] font-bold uppercase tracking-[0.05em] text-core-primary">
                        <Icon name="push_pin" className="!text-[16px]" />
                        Core objective & synopsis
                      </span>
                      <p className="text-base leading-relaxed text-core-on-surface">{result.summary || "Summary will appear once processing completes."}</p>
                      {result.error_message ? <p className="text-sm font-medium text-state-on-danger-soft">{result.error_message}</p> : null}
                      {result.status === "failed" && result.is_owner ? (
                        <button type="button" onClick={() => void onRetryJob()} disabled={retrying} className="self-start rounded-lg bg-core-primary px-3 py-2 text-sm font-semibold text-core-on-primary disabled:opacity-50">
                          {retrying ? "Retrying…" : "Retry this job"}
                        </button>
                      ) : null}
                    </div>

                    {result.tags?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {result.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-core-surface-container px-3 py-1 text-[12px] font-medium text-core-on-surface-variant">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {isPro && result.analysis?.decisions.length ? (
                      <div className="space-y-2 border-t border-core-outline-variant/20 pt-3">
                        <span className="font-jetbrains-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-core-outline">
                          Key decisions
                        </span>
                        <ul className="space-y-1.5">
                          {result.analysis.decisions.slice(0, 3).map((decision, index) => (
                            <li key={`summary-decision-${index}`} className="flex items-start gap-2 text-sm text-core-on-surface">
                              <Icon name="gavel" className="mt-0.5 shrink-0 !text-[16px] text-core-primary" />
                              {decision}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </SectionCard>
                  ) : null}

                  {tab === "moments" ? (
                  <SectionCard className="flex flex-col gap-4 p-6">
                    <div className="flex items-center gap-2">
                      <Icon name="assignment_turned_in" className="!text-[22px] text-core-primary" />
                      <h2 className="font-display text-[18px] font-bold tracking-tight text-core-on-surface">Highlight checklist</h2>
                    </div>
                    <div className="space-y-3">
                      {keyPoints.map((point) => (
                        <button
                          key={`hl-${point.timestamp_seconds}`}
                          type="button"
                          onClick={() => jumpTo(point)}
                          className="w-full rounded-xl bg-core-surface-container-low p-3 text-left transition-colors hover:bg-core-surface-container"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-core-on-surface">{point.title}</span>
                            <span className="rounded bg-core-surface-container px-2 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-primary">
                              {toClock(point.timestamp_seconds)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[12px] text-core-on-surface-variant">{point.description}</p>
                        </button>
                      ))}
                    </div>
                  </SectionCard>
                  ) : null}

                  {tab === "chapters" ? (
                  <SectionCard className="flex flex-col gap-4 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon name="video_library" className="!text-[22px] text-core-primary" />
                        <h2 className="font-display text-[18px] font-bold tracking-tight text-core-on-surface">Key video chapters</h2>
                      </div>
                      <span className="font-jetbrains-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-core-outline">Click to play</span>
                    </div>
                    <div className="space-y-2">
                      {keyPoints.map((point) => {
                        const active = activeTimestamp === point.timestamp_seconds;
                        return (
                          <button
                            key={`ch-${point.timestamp_seconds}`}
                            type="button"
                            onClick={() => jumpTo(point)}
                            className={`group flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left transition-colors ${
                              active ? "bg-core-surface-container-low" : "hover:bg-core-surface-container-low"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className={`rounded px-2 py-1 font-jetbrains-mono text-[12px] font-bold transition-colors ${
                                  active
                                    ? "bg-core-primary text-core-on-primary"
                                    : "bg-core-surface-container-high text-core-primary group-hover:bg-core-primary group-hover:text-core-on-primary"
                                }`}
                              >
                                {toClock(point.timestamp_seconds)}
                              </span>
                              <span className="flex min-w-0 flex-col">
                                <span className={`truncate text-sm font-semibold ${active ? "text-core-primary" : "text-core-on-surface"}`}>
                                  {point.title}
                                </span>
                                <span className="truncate text-[12px] text-core-outline">{point.description}</span>
                              </span>
                            </div>
                            <Icon
                              name={active ? "graphic_eq" : "play_circle"}
                              className={`!text-[20px] ${active ? "text-core-primary" : "text-core-outline group-hover:text-core-primary"}`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </SectionCard>
                  ) : null}

                  {tab === "actionItems" && isPro ? (
                  <SectionCard className="flex flex-col gap-4 p-6">
                    <div className="flex items-center gap-2">
                      <Icon name="checklist" className="!text-[22px] text-core-primary" />
                      <h2 className="font-display text-[18px] font-bold tracking-tight text-core-on-surface">
                        Immediate Action Items
                      </h2>
                    </div>
                    {allActionItems.length ? (
                      <ul className="space-y-3">
                        {allActionItems.map((item, index) => {
                          const key = `${result.job_id}:${index}`;
                          const detail = result.analysis?.action_item_details?.find((entry) => entry.title === item);
                          const done =
                            pendingActionItems[index] ?? (result.completed_action_items ?? []).includes(index);
                          return (
                            <li key={key} className="flex items-start gap-3 rounded-2xl bg-core-primary-fixed p-4">
                              <button
                                type="button"
                                disabled={!result.is_owner}
                                aria-pressed={done}
                                onClick={() => void toggleActionItem(index, !done)}
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                                  done ? "border-core-primary bg-core-primary" : "border-core-primary/30 bg-core-surface-container-lowest"
                                }`}
                              >
                                {done ? <Icon name="check" className="!text-[14px] text-core-on-primary" /> : null}
                              </button>
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm font-semibold leading-relaxed ${done ? "text-core-on-surface-variant line-through" : "text-core-on-surface"}`}>
                                  {item}
                                </p>
                                {detail?.owner || detail?.due || detail?.priority ? (
                                  <p className="mt-1 text-xs text-core-on-surface-variant">
                                    {[detail.owner ? `Owner: ${detail.owner}` : null, detail.due ? `Due: ${detail.due}` : null, detail.priority ? `${detail.priority} priority` : null].filter(Boolean).join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                              {done ? (
                                <span className="shrink-0 rounded-lg bg-core-primary-container/20 px-2.5 py-1 text-[11px] font-bold text-core-primary">
                                  Done
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="py-6 text-center text-sm text-core-on-surface-variant">
                        No action items were captured for this recording yet.
                      </p>
                    )}
                    {result.is_owner ? <button
                      type="button"
                      onClick={() => setAddActionItemOpen(true)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-core-primary-fixed py-3 text-sm font-semibold text-core-primary hover:bg-core-surface-container-high"
                    >
                      <Icon name="add" className="!text-[18px]" />
                      Add Custom Action Item
                    </button> : null}
                  </SectionCard>
                  ) : null}

                  {tab === "transcript" ? (
                  result.transcript_text ? (
                    <SectionCard className="flex flex-col gap-2.5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-core-outline-variant/20 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-core-primary-fixed text-core-primary">
                            <Icon name="subject" className="!text-[16px]" />
                          </div>
                          <h3 className="font-display text-[15px] font-bold text-core-on-surface">Raw transcript</h3>
                          {result.transcript_source === "user_provided" ? (
                            <span className="flex items-center gap-1 rounded-full bg-core-primary-fixed px-2 py-0.5 font-jetbrains-mono text-[10px] font-bold text-core-primary">
                              <Icon name="upload_file" className="!text-[12px]" />
                              User-provided
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {transcriptSegments.length ? (
                            <button
                              type="button"
                              onClick={() => setTranscriptSync((prev) => !prev)}
                              aria-pressed={transcriptSync}
                              title={transcriptSync ? "Playback auto-scrolls the transcript" : "Transcript stays put while the video plays"}
                              className={`flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold shadow-sm transition-all ${
                                transcriptSync
                                  ? "bg-core-primary text-core-on-primary"
                                  : "bg-core-surface-container-low text-core-on-surface hover:bg-core-surface-container"
                              }`}
                            >
                              <Icon name={transcriptSync ? "sync" : "sync_disabled"} className="!text-[14px]" />
                              {transcriptSync ? "Synced" : "Sync"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(result.transcript_text ?? "")}
                            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-core-surface-container-low px-2.5 text-[11px] font-semibold text-core-on-surface shadow-sm transition-all hover:bg-core-surface-container"
                          >
                            <Icon name="content_copy" className="!text-[14px] text-core-outline" />
                            Copy
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <Icon
                          name="search"
                          className="pointer-events-none absolute left-2.5 top-1/2 !text-[16px] -translate-y-1/2 text-core-outline"
                        />
                        <input
                          type="search"
                          value={transcriptQuery}
                          onChange={(event) => setTranscriptQuery(event.target.value)}
                          placeholder="Search transcript…"
                          className="w-full rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest py-1.5 pl-8 pr-20 text-[13px] text-core-on-surface placeholder:text-core-outline focus:border-core-primary focus:outline-none"
                        />
                        {transcriptQuery.trim() ? (
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-jetbrains-mono text-[10px] font-semibold text-core-outline">
                            {transcriptMatchCount} match{transcriptMatchCount === 1 ? "" : "es"}
                          </span>
                        ) : null}
                      </div>

                      {transcriptSegments.length ? (
                        <div
                          ref={transcriptListRef}
                          className="flex max-h-[560px] flex-col gap-1 overflow-y-auto rounded-xl bg-core-surface-container-low p-2"
                        >
                          {transcriptSegments.map((segment, index) => {
                            const active = index === activeSegmentIndex;
                            const colorIndex = segment.speaker ? speakerColorIndex.get(segment.speaker) ?? 0 : -1;
                            const color = colorIndex >= 0 ? SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length] : null;
                            return (
                              <div
                                key={`segment-${index}`}
                                ref={(el) => {
                                  segmentRefs.current[index] = el;
                                }}
                                role="button"
                                tabIndex={0}
                                onClick={() => seekToSeconds(segment.start)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    seekToSeconds(segment.start);
                                  }
                                }}
                                className={`group flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                                  active ? "bg-core-primary-fixed ring-1 ring-core-primary/40" : "hover:bg-core-surface-container"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-jetbrains-mono text-[10px] font-bold ${
                                    color ? `${color.avatarBg} ${color.avatarText}` : "bg-core-outline-variant text-core-on-surface-variant"
                                  }`}
                                >
                                  {segment.speaker ? speakerInitials(segment.speaker) : "?"}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {segment.speaker ? (
                                      <span className="text-[12.5px] font-bold text-core-on-surface">{segment.speaker}</span>
                                    ) : null}
                                    <span
                                      className={`shrink-0 rounded px-1 py-0.5 font-jetbrains-mono text-[10px] font-semibold transition-colors ${
                                        active
                                          ? "bg-core-primary text-core-on-primary"
                                          : "bg-core-surface-container text-core-primary group-hover:bg-core-primary group-hover:text-core-on-primary"
                                      }`}
                                    >
                                      {toClock(segment.start)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[13px] leading-snug text-core-on-surface-variant">
                                    {highlightMatches(segmentDialogue(segment), transcriptQuery)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="max-h-[560px] overflow-y-auto rounded-xl bg-core-surface-container-low p-3">
                          <p className="whitespace-pre-wrap text-[13px] leading-snug text-core-on-surface">
                            {highlightMatches(result.transcript_text, transcriptQuery)}
                          </p>
                        </div>
                      )}
                    </SectionCard>
                  ) : (
                    <SectionCard className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                      <Icon name="subject" className="!text-[32px] text-core-outline" />
                      <p className="max-w-md text-sm text-core-on-surface-variant">
                        {status === "completed"
                          ? "A raw transcript wasn't persisted for this job. Re-run processing on a new upload to see it here."
                          : "The raw transcript will appear here once processing completes."}
                      </p>
                    </SectionCard>
                  )
                  ) : null}
                </TabScrollArea>

                {/* Glossary */}
                {isPro && result.analysis?.terms.length ? (
                  <div data-chat-context-id={GLOSSARY_CHAT_CONTEXT.context_id} data-chat-context-label={GLOSSARY_CHAT_CONTEXT.label}>
                    <SectionCard className="flex flex-col gap-4 p-6">
                      <div className="flex items-center justify-between gap-3 border-b border-core-outline-variant/20 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
                            <Icon name="menu_book" className="!text-[20px]" />
                          </div>
                          <h3 className="font-display text-[18px] font-bold text-core-on-surface">Glossary</h3>
                        </div>
                        <button type="button" onClick={() => { setActiveChatSection(GLOSSARY_CHAT_CONTEXT); setChatOpen(true); }} className="flex h-8 items-center gap-1.5 rounded-lg bg-core-primary-fixed px-2.5 text-[12px] font-semibold text-core-primary hover:bg-core-surface-container-high" title="Attach the glossary to Ask this video">
                          <Icon name="auto_awesome" className="!text-[15px]" />
                          Ask AI
                        </button>
                      </div>
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {result.analysis.terms.map((term, index) => (
                          <div key={`term-${index}`} className="rounded-xl bg-core-surface-container-low p-3">
                            <dt className="text-sm font-bold text-core-on-surface">{term.term}</dt>
                            <dd className="mt-0.5 text-[13px] text-core-on-surface-variant">{term.meaning}</dd>
                          </div>
                        ))}
                      </dl>
                    </SectionCard>
                  </div>
                ) : null}

                {/* Recent notes */}
                <SectionCard className="flex flex-col gap-3 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="history" className="!text-[22px] text-core-primary" />
                      <h2 className="font-display text-[18px] font-bold tracking-tight text-core-on-surface">Recent notes</h2>
                    </div>
                    <Link href="/workspace/history" className="text-[12px] font-semibold text-core-primary hover:underline">
                      View all
                    </Link>
                  </div>
                  <ul className="space-y-1.5">
                    {history.slice(0, 8).map((job) => {
                      const active = result.job_id === job.job_id;
                      return (
                        <li key={job.job_id}>
                          <button
                            type="button"
                            onClick={() => {
                              setResult(job);
                              setActiveTimestamp(null);
                              setChatContexts([REPORT_CHAT_CONTEXT.summary]);
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                              active ? "bg-core-surface-container-low" : "hover:bg-core-surface-container-low"
                            }`}
                          >
                            <span className={`h-8 w-1 shrink-0 rounded-full ${active ? "bg-core-primary" : "bg-transparent"}`} />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm font-semibold ${active ? "text-core-primary" : "text-core-on-surface"}`}>
                                {jobTitle(job)}
                              </span>
                              <span className="font-jetbrains-mono text-[11px] uppercase tracking-[0.05em] text-core-outline">{job.status}</span>
                            </span>
                            <Icon name="chevron_right" className="!text-[18px] text-core-outline" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </SectionCard>
              </div>
            </div>
          )}
        </main>

        <Footer />
      </div>

      {result ? (
        <AskVideoDrawer
          jobId={result.job_id}
          title={title}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onJump={seekToSeconds}
          selectedContexts={chatContexts}
          onRemoveContext={(index) => setChatContexts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
        />
      ) : null}

      {addActionItemOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-core-primary/10 bg-core-surface p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-core-primary-fixed text-core-primary">
                <Icon name="checklist" className="!text-[22px]" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddActionItemOpen(false);
                  setActionItemDraft("");
                  setActionItemError(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container"
                title="Cancel"
              >
                <Icon name="close" className="!text-[18px]" />
              </button>
            </div>

            <h2 className="mt-4 text-lg font-bold tracking-tight text-core-on-surface">Add a custom action item</h2>
            <p className="mt-1 text-[13px] font-medium text-core-on-surface-variant">
              This will be added to the action items list for this recording.
            </p>

            <textarea
              autoFocus
              rows={3}
              value={actionItemDraft}
              onChange={(event) => setActionItemDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitCustomActionItem();
                }
              }}
              placeholder="e.g. Follow up with design team about the new mockups"
              className="mt-5 w-full resize-none rounded-xl border border-core-outline-variant/40 bg-core-surface-container-lowest px-4 py-3 text-sm text-core-on-surface shadow-inner outline-none transition focus:border-core-primary focus:ring-2 focus:ring-core-primary/30"
            />

            {actionItemError ? <p className="mt-2 text-xs font-medium text-state-on-danger-soft">{actionItemError}</p> : null}

            <div className="mt-5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setAddActionItemOpen(false);
                  setActionItemDraft("");
                  setActionItemError(null);
                }}
                className="flex-1 rounded-xl border border-core-outline-variant/40 px-4 py-2.5 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!actionItemDraft.trim() || actionItemSaving}
                onClick={() => void submitCustomActionItem()}
                className="flex-1 rounded-xl bg-core-primary px-4 py-2.5 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionItemSaving ? "Adding..." : "Add item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <AuthGuard>
      <InsightsPageContent />
    </AuthGuard>
  );
}

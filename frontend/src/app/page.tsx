"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { AuthGuard } from "@/components/AuthGuard";
import { Footer } from "@/components/Footer";
import { useProcessing } from "@/components/ProcessingContext";
import { ProductTour, TourStep } from "@/components/ProductTour";
import { useSidebar } from "@/components/SidebarContext";
import { TranscriptSourceDialog } from "@/components/TranscriptSourceDialog";
import { StatusBanner } from "@/components/ui/StatusBanner";
import {
  assignJobProject,
  createProject,
  createJob,
  createJobFromUrl,
  getUsageSummary,
  getUserProfile,
  listJobs,
  listProjects,
  presignUpload,
  uploadFileToSignedUrl,
} from "@/lib/api";
import { jobSourceIcon, jobSourceLabel, jobThumbnail } from "@/lib/jobThumbnail";
import {
  JobCreateResponse,
  Project,
  UsageSummaryResponse,
  UserProfileResponse,
} from "@/types/job";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function statusBadge(status: JobCreateResponse["status"]) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-semibold text-state-on-success-soft">
        <Icon name="check_circle" className="!text-[14px]" />
        Ready to read
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-state-danger-soft px-2.5 py-1 text-xs font-semibold text-state-on-danger-soft">
        <Icon name="error" className="!text-[14px]" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-on-warning-soft">
      <Icon name="autorenew" className="!text-[14px]" />
      Processing
    </span>
  );
}

function noteHref(job: JobCreateResponse) {
  return job.status === "completed" || job.status === "failed"
    ? `/workspace/insights?job=${job.job_id}`
    : `/workspace/analyzing?job=${job.job_id}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "[data-tour='create']",
    title: "Start with a link or a file",
    body: "Paste a YouTube, Vimeo, or Loom URL here, or upload a recording from your computer. That is the only step you have to do.",
  },
  {
    target: "[data-tour='usage']",
    title: "Keep an eye on your allowance",
    body: "These cards show the storage and transcription hours you have actually used on your current plan.",
  },
  {
    target: "[data-tour='recent']",
    title: "Your summaries land here",
    body: "Once a video finishes processing, its one-page summary, key moments, and action items appear in this list.",
  },
  {
    target: "[data-tour='history']",
    title: "Find your saved notes",
    body: "History keeps your notes searchable for the retention period included with your current plan.",
  },
];

function DashboardHome() {
  const { beginProcessing, startProcessing, failPreparing, setUploadProgress } = useProcessing();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobCreateResponse[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    void listJobs(20)
      .then(setHistory)
      .catch(() => setHistory([]));
    void getUserProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    void getUsageSummary()
      .then(setUsage)
      .catch(() => setUsage(null));
    void listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function onCreateProject() {
    if (!newProjectName.trim()) return;
    try {
      const project = await createProject(newProjectName.trim());
      setProjects((current) => [...current, project].sort((a, b) => a.name.localeCompare(b.name)));
      setProjectId(project.project_id);
      setNewProjectName("");
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create project.");
    }
  }

  async function assignSelectedProject(jobId: string) {
    if (!projectId) return;
    try {
      await assignJobProject(jobId, projectId);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Note created, but project assignment failed.");
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Paste a YouTube, Vimeo, or Loom URL to get started.");
      return;
    }

    setSubmitting(true);
    beginProcessing(url.trim());
    try {
      const job = await createJobFromUrl({ url: url.trim() });
      await assignSelectedProject(job.job_id);
      startProcessing(job.job_id);
      setUrl("");
    } catch (submissionError) {
      failPreparing();
      // The link endpoint explains *why* a URL was refused, so show that rather than a generic line.
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We couldn't start that job. Check the link and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function onUploadClick() {
    fileInputRef.current?.click();
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPendingVideoFile(file);
  }

  async function uploadVideoAndCreateJob(file: File, transcriptFile: File | null) {
    setSubmitting(true);
    beginProcessing(file.name);
    try {
      const presigned = await presignUpload({
        file_name: file.name,
        content_type: file.type || "application/octet-stream",
        file_size: file.size,
      });
      await uploadFileToSignedUrl(presigned.upload_url, file, presigned.headers, setUploadProgress, presigned.method, presigned.fields);

      let transcriptObjectKey: string | undefined;
      if (transcriptFile) {
        const transcriptPresigned = await presignUpload({
          file_name: transcriptFile.name,
          content_type: transcriptFile.type || "application/octet-stream",
          file_size: transcriptFile.size,
        });
        await uploadFileToSignedUrl(transcriptPresigned.upload_url, transcriptFile, transcriptPresigned.headers, undefined, transcriptPresigned.method, transcriptPresigned.fields);
        transcriptObjectKey = transcriptPresigned.object_key;
      }

      const job = await createJob({
        source_type: "upload",
        file_name: file.name,
        upload_object_key: presigned.object_key,
        ...(transcriptObjectKey ? { transcript_object_key: transcriptObjectKey, transcript_file_name: transcriptFile!.name } : {}),
      });
      await assignSelectedProject(job.job_id);
      startProcessing(job.job_id);
    } catch (uploadError) {
      failPreparing();
      setError(uploadError instanceof Error ? uploadError.message : "We couldn't upload that file. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onTranscriptDialogConfirm(transcriptFile: File | null) {
    const file = pendingVideoFile;
    setPendingVideoFile(null);
    if (!file) return;
    void uploadVideoAndCreateJob(file, transcriptFile);
  }

  const { collapsed } = useSidebar();

  const firstName = profile?.full_name?.trim().split(" ")[0] || profile?.email?.split("@")[0] || "there";
  const activeJob = history.find((job) => job.status === "queued" || job.status === "processing") ?? null;
  const recentNotes = history.slice(0, 3);
  const completedCount = history.filter((job) => job.status === "completed").length;

  const remaining = (meter: { used: number; limit?: number | null }) =>
    Math.max(0, Math.round(((meter.limit ?? 0) - meter.used) * 10) / 10);
  const storageCaption = !usage
    ? "Loading usage…"
    : usage.storage_gb.limit == null
      ? "Unlimited storage on your plan"
      : `${remaining(usage.storage_gb)} ${usage.storage_gb.unit} available`;
  const transcriptionCaption = !usage
    ? "Loading usage…"
    : usage.transcription_hours.limit == null
      ? "Unlimited transcription"
      : `${remaining(usage.transcription_hours)} ${usage.transcription_hours.unit} remaining`;

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="relative isolate overflow-hidden pb-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-core-primary/5 blur-3xl"
          />

          <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6">
            {activeJob ? (
              <div className="flex w-full flex-col items-center justify-between gap-4 rounded-2xl bg-core-secondary-container/50 p-4 shadow-sm sm:flex-row sm:p-5">
                <div className="flex w-full items-center gap-4 sm:w-auto">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-core-primary-container/15 text-core-primary">
                    <Icon name="auto_awesome" className="!text-[20px] animate-pulse" />
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-core-primary opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-core-primary" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-core-on-surface">
                        Currently summarizing: {activeJob.file_name || activeJob.source_url || activeJob.job_id}
                      </span>
                      <span className="rounded-full bg-core-primary/10 px-2 py-0.5 text-xs font-semibold text-core-primary">
                        {activeJob.status === "processing" ? "Almost ready" : "Queued"}
                      </span>
                    </div>
                    <p className="text-sm text-core-on-surface-variant">We&apos;ll notify you the moment it&apos;s ready.</p>
                  </div>
                </div>
                <Link
                  href={`/workspace/analyzing?job=${activeJob.job_id}`}
                  className="flex items-center gap-1.5 rounded-xl bg-core-surface-container-lowest px-4 py-2 text-sm font-semibold text-core-primary shadow-sm transition hover:bg-core-surface"
                >
                  View Progress
                  <Icon name="arrow_forward" className="!text-[16px]" />
                </Link>
              </div>
            ) : null}

            <div className="relative overflow-hidden rounded-3xl bg-core-surface-container-lowest p-8 shadow-sm sm:p-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-core-primary-fixed/20 blur-3xl"
              />
              <div className="relative z-10 max-w-3xl space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-core-surface-container-low px-3 py-1 text-xs font-semibold text-core-primary">
                  <Icon name="bolt" className="!text-[14px]" />
                  Effortless Meeting &amp; Video Recaps
                </span>
                <h1 className="text-3xl font-bold tracking-tight text-core-on-surface sm:text-4xl">
                  {greeting()}, {firstName}
                </h1>
                <p className="text-lg text-core-on-surface-variant">
                  Paste any video or meeting link to get instant, organized notes without lifting a finger.
                </p>
              </div>

              <form
                data-tour="create"
                onSubmit={onGenerate}
                className="relative z-10 mt-8 flex flex-col items-stretch gap-3 rounded-2xl bg-core-surface-container-low p-2 shadow-inner md:flex-row"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
                  <Icon name="link" className="ml-1 shrink-0 !text-[22px] text-core-outline" />
                  <input
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Paste YouTube, Zoom, Loom, or meeting link here..."
                    className="w-full border-none bg-transparent text-sm text-core-on-surface outline-none placeholder:text-core-outline"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={onFileSelected} />
                  <button
                    type="button"
                    onClick={onUploadClick}
                    disabled={submitting}
                    className="flex h-12 items-center gap-2 whitespace-nowrap rounded-xl bg-core-surface-container-lowest px-4 text-sm font-semibold text-core-on-surface-variant shadow-sm transition hover:bg-core-surface hover:text-core-on-surface disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Icon name="cloud_upload" className="!text-[18px]" />
                    <span className="hidden sm:inline">Upload</span>
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-core-primary px-6 text-sm font-semibold text-core-on-primary shadow-md transition hover:bg-core-surface-tint hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Starting…" : "Get Notes"}
                    <Icon name="arrow_forward" className="!text-[18px]" />
                  </button>
                </div>
              </form>
              <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 px-2 text-sm">
                <label htmlFor="new-note-project" className="font-medium text-core-on-surface-variant">Save to project</label>
                <select id="new-note-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest px-3 py-2 text-core-on-surface">
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}
                </select>
                <input aria-label="New project name" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New project name" maxLength={120} className="rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest px-3 py-2 text-core-on-surface" />
                <button type="button" onClick={() => void onCreateProject()} disabled={!newProjectName.trim()} className="rounded-lg bg-core-primary-fixed px-3 py-2 font-semibold text-core-primary disabled:opacity-50">Create project</button>
              </div>
              {error ? (
                <div className="relative z-10 mt-3">
                  <StatusBanner tone="error">{error}</StatusBanner>
                </div>
              ) : null}
              <div className="relative z-10 mt-3 flex flex-wrap items-center gap-4 px-2 text-sm text-core-on-surface-variant">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                  Auto-detects speakers
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                  Action items highlighted
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                  No setup needed
                </span>
              </div>
            </div>

            <div data-tour="usage" className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="flex items-center justify-between rounded-2xl bg-core-surface-container-lowest p-6 shadow-sm">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                    Notes Created
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-core-on-surface">{history.length}</span>
                    <span className="text-sm font-semibold text-state-on-success-soft">{completedCount} ready</span>
                  </div>
                  <p className="text-sm text-core-on-surface-variant">Ready to read, share, and export</p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-core-surface-container text-core-primary">
                  <Icon name="description" className="!text-[26px]" />
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl bg-core-surface-container-lowest p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                      Storage Used
                    </span>
                    <div className="flex items-baseline gap-1.5 pt-0.5">
                      <span className="text-3xl font-bold text-core-on-surface">
                        {usage ? usage.storage_gb.used : "--"}
                      </span>
                      <span className="text-sm font-semibold text-core-on-surface-variant">
                        {usage ? `/ ${usage.storage_gb.limit ?? "∞"} ${usage.storage_gb.unit}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-core-surface-container text-core-primary">
                    <Icon name="cloud_done" className="!text-[26px]" />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-core-surface-container">
                    <div
                      className="h-full rounded-full bg-core-primary transition-[width] duration-500"
                      style={{ width: `${usage?.storage_gb.percent ?? 0}%` }}
                    />
                  </div>
                  <p className="text-sm text-core-on-surface-variant">{storageCaption}</p>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl bg-core-surface-container-lowest p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                      Transcription Limit
                    </span>
                    <div className="flex items-baseline gap-1.5 pt-0.5">
                      <span className="text-3xl font-bold text-core-on-surface">
                        {usage ? usage.transcription_hours.used : "--"}
                      </span>
                      <span className="text-sm font-semibold text-core-on-surface-variant">
                        {usage
                          ? `/ ${usage.transcription_hours.limit ?? "∞"} ${usage.transcription_hours.unit}`
                          : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-core-surface-container text-core-primary">
                    <Icon name="bolt" className="!text-[26px]" />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-core-surface-container">
                    <div
                      className="h-full rounded-full bg-core-primary transition-[width] duration-500"
                      style={{ width: `${usage?.transcription_hours.percent ?? 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm text-core-on-surface-variant">
                    <span>{transcriptionCaption}</span>
                    <Link href="/upgrade" className="flex items-center gap-0.5 font-semibold text-core-primary hover:underline">
                      Upgrade
                      <Icon name="arrow_forward" className="!text-[14px]" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
              <div data-tour="recent" className="space-y-6 lg:col-span-8">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-xl font-bold text-core-on-surface">Recent Summaries</h2>
                    <p className="text-sm text-core-on-surface-variant">Clear, executive takeaways from your recordings</p>
                  </div>
                  <Link
                    href="/workspace/history"
                    className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-core-surface-container-lowest px-3.5 text-sm font-semibold text-core-on-surface shadow-sm transition hover:bg-core-surface-container-high"
                  >
                    View all
                    <Icon name="arrow_forward" className="!text-[16px]" />
                  </Link>
                </div>

                {recentNotes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-core-outline-variant/40 bg-core-surface-container-lowest px-4 py-10 text-center text-sm text-core-on-surface-variant">
                    No notes yet. Paste a link above to generate your first one.
                  </div>
                ) : (
                  recentNotes.map((job) => (
                    <Link
                      key={job.job_id}
                      href={noteHref(job)}
                      className="group flex flex-col items-start gap-6 rounded-2xl bg-core-surface-container-lowest p-6 shadow-sm transition hover:shadow-md md:flex-row"
                    >
                      <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-xl bg-core-surface-container text-core-primary md:w-56">
                        {jobThumbnail(job) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={jobThumbnail(job)!}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Icon name={jobSourceIcon(job)} className="!text-[40px]" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {statusBadge(job.status)}
                          {(job.tags ?? []).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full bg-core-surface-container-low px-2.5 py-1 text-xs font-semibold text-core-on-surface-variant"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <h3 className="text-lg font-bold leading-snug text-core-on-surface transition-colors group-hover:text-core-primary">
                          {job.file_name || job.source_url || job.job_id}
                        </h3>
                        <p className="line-clamp-2 text-sm text-core-on-surface-variant">
                          {job.summary || "Waiting for processing output..."}
                        </p>
                        <div className="flex items-center justify-between gap-4 pt-2">
                          <span className="text-xs font-semibold text-core-on-surface-variant">
                            {jobSourceLabel(job)}
                          </span>
                          <span className="flex h-10 items-center gap-2 rounded-xl bg-core-primary px-5 text-sm font-semibold text-core-on-primary shadow-sm transition group-hover:bg-core-surface-tint">
                            Read Note
                            <Icon name="menu_book" className="!text-[16px]" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>

              <div className="space-y-6 lg:col-span-4">
                <div className="space-y-4 rounded-2xl bg-gradient-to-br from-core-primary-fixed/40 to-core-surface-container-lowest p-6 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-core-primary text-core-on-primary shadow-sm">
                    <Icon name="lightbulb" className="!text-[22px]" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-lg font-bold text-core-on-surface">How FrameNote works</h4>
                    <p className="text-sm leading-relaxed text-core-on-surface-variant">
                      We listen to your meeting or video, write a clear 1-page executive summary, and highlight decisions
                      so you never have to re-watch a meeting.
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setTourOpen(true)}
                      className="flex items-center gap-1 text-sm font-semibold text-core-primary hover:underline"
                    >
                      Take a 2-min tour
                      <Icon name="north_east" className="!text-[16px]" />
                    </button>
                    <span className="text-xs font-semibold text-core-on-surface-variant">Simple Guide</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-core-surface-container-lowest p-5 text-sm text-core-on-surface-variant shadow-sm">
                  Email notifications and weekly briefings will be added after the beta email service is connected.
                </div>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>

      {pendingVideoFile ? (
        <TranscriptSourceDialog
          videoLabel={pendingVideoFile.name}
          onCancel={() => setPendingVideoFile(null)}
          onConfirm={onTranscriptDialogConfirm}
        />
      ) : null}

      {tourOpen ? <ProductTour steps={TOUR_STEPS} onClose={() => setTourOpen(false)} /> : null}
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthGuard>
      <DashboardHome />
    </AuthGuard>
  );
}

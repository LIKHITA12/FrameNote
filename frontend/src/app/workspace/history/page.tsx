"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { Footer } from "@/components/Footer";
import { AuthGuard } from "@/components/AuthGuard";
import { useSidebar } from "@/components/SidebarContext";
import { deleteProject, listHistory, listProjects, renameProject } from "@/lib/api";
import { jobThumbnail } from "@/lib/jobThumbnail";
import {
  HistoryDateRange,
  HistoryFacets,
  HistorySort,
  HistorySource,
  JobCreateResponse,
  Project,
} from "@/types/job";

const PAGE_SIZE = 6;

const DATE_RANGES: { value: HistoryDateRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range..." },
];

const SOURCES: { value: HistorySource; label: string }[] = [
  { value: "youtube", label: "YouTube Integration" },
  { value: "url", label: "Video Links" },
  { value: "upload", label: "Direct Uploads" },
  { value: "zoom", label: "Zoom Meetings" },
];

const SORTS: { value: HistorySort; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "title", label: "Title (A-Z)" },
  { value: "longest", label: "Longest Duration" },
];

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function formatDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function jobTitle(job: JobCreateResponse): string {
  return job.file_name || job.source_url || job.job_id;
}

function noteHref(job: JobCreateResponse): string {
  return job.status === "completed" || job.status === "failed"
    ? `/workspace/insights?job=${job.job_id}`
    : `/workspace/analyzing?job=${job.job_id}`;
}

function statusChip(status: JobCreateResponse["status"]) {
  if (status === "completed") return null;
  const tone =
    status === "failed" ? "bg-state-danger-soft text-state-on-danger-soft" : "bg-state-warning-soft text-state-on-warning-soft";
  const label = status === "failed" ? "Failed" : status === "processing" ? "Processing" : "Queued";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
        checked ? "border-core-primary" : "border-core-outline-variant group-hover:border-core-primary"
      }`}
    >
      <span className={`h-2 w-2 rounded-full bg-core-primary ${checked ? "" : "hidden"}`} />
    </span>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
        checked
          ? "border-core-primary bg-core-primary"
          : "border-core-outline-variant group-hover:border-core-primary"
      }`}
    >
      <Icon
        name="check"
        className={`!text-[12px] text-core-on-primary ${checked ? "" : "invisible"}`}
      />
    </span>
  );
}

function SourceIcon({ job }: { job: JobCreateResponse }) {
  const youtube = job.source_type === "youtube";
  const link = job.source_type === "url";
  return (
    <span className="absolute left-2 top-2 rounded bg-core-surface/90 p-1 shadow-sm backdrop-blur">
      <Icon
        name={youtube ? "play_arrow" : link ? "link" : "upload_file"}
        className={`!text-[16px] ${youtube ? "text-[#FF0000]" : "text-core-primary"}`}
      />
    </span>
  );
}

function Thumbnail({ job, className = "sm:w-48" }: { job: JobCreateResponse; className?: string }) {
  const src = jobThumbnail(job);
  const duration = formatDuration(job.duration_seconds);

  return (
    <div
      className={`relative h-32 w-full shrink-0 overflow-hidden rounded-lg border border-core-outline-variant/15 bg-core-surface-container ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-core-on-surface-variant/50">
          <Icon name="movie" className="!text-[32px]" />
        </span>
      )}
      <SourceIcon job={job} />
      {duration ? (
        <span className="absolute bottom-2 right-2 rounded bg-core-inverse-surface/80 px-2 py-1 font-jetbrains-mono text-[10px] font-semibold text-core-inverse-on-surface backdrop-blur">
          {duration}
        </span>
      ) : null}
    </div>
  );
}

function HistoryRow({ job }: { job: JobCreateResponse }) {
  return (
    <Link
      href={noteHref(job)}
      className="group relative flex flex-col items-start gap-5 overflow-hidden rounded-xl border border-core-outline-variant/20 bg-core-surface p-4 transition-all hover:border-core-primary/30 hover:shadow-md sm:flex-row"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-1 origin-top scale-y-0 bg-core-primary transition-transform group-hover:scale-y-100"
      />
      <Thumbnail job={job} />

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <h3 className="truncate font-display text-base font-semibold text-core-on-surface transition-colors group-hover:text-core-primary">
            {jobTitle(job)}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            {statusChip(job.status)}
            <span className="whitespace-nowrap font-jetbrains-mono text-xs text-core-outline">
              {formatDate(job.created_at)}
            </span>
          </div>
        </div>

        <p className="mb-3 line-clamp-2 text-sm text-core-on-surface-variant">
          {job.summary || "Waiting for processing output..."}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(job.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded border border-core-outline-variant/20 bg-core-surface-container-low px-2 py-1 font-jetbrains-mono text-[10px] font-semibold text-core-on-surface-variant"
            >
              <Icon name="sell" className="!text-[14px]" />
              {tag}
            </span>
          ))}
          {job.insights_count ? (
            <span className="ml-2 inline-flex items-center gap-1 font-jetbrains-mono text-[10px] font-semibold text-core-primary">
              <Icon name="psychology" className="!text-[14px]" />
              {job.insights_count} Insights Extracted
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function HistoryCard({ job }: { job: JobCreateResponse }) {
  return (
    <Link
      href={noteHref(job)}
      className="group flex flex-col overflow-hidden rounded-xl border border-core-outline-variant/20 bg-core-surface transition-all hover:border-core-primary/30 hover:shadow-md"
    >
      <Thumbnail job={job} className="rounded-b-none border-x-0 border-t-0" />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-display text-sm font-semibold text-core-on-surface transition-colors group-hover:text-core-primary">
            {jobTitle(job)}
          </h3>
          {statusChip(job.status)}
        </div>
        <p className="mb-3 line-clamp-2 text-xs text-core-on-surface-variant">
          {job.summary || "Waiting for processing output..."}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 font-jetbrains-mono text-[10px] text-core-outline">
          <span>{formatDate(job.created_at)}</span>
          {job.insights_count ? (
            <span className="inline-flex items-center gap-1 font-semibold text-core-primary">
              <Icon name="psychology" className="!text-[14px]" />
              {job.insights_count}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function FilterHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 border-b border-core-outline-variant/20 pb-1.5 font-display text-base font-semibold text-core-on-surface">
      {children}
    </h3>
  );
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const { collapsed } = useSidebar();

  const [view, setView] = useState<"list" | "grid">("list");
  const [dateRange, setDateRange] = useState<HistoryDateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sources, setSources] = useState<HistorySource[]>(["youtube", "url", "upload"]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sort, setSort] = useState<HistorySort>("newest");
  const [searchInput, setSearchInput] = useState(urlQuery);
  const [search, setSearch] = useState(urlQuery);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get("project") ?? "");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectEditOpen, setProjectEditOpen] = useState(false);

  useEffect(() => {
    void listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function onRenameProject() {
    if (!projectId || !projectNameDraft.trim()) return;
    try {
      const updated = await renameProject(projectId, projectNameDraft.trim());
      setProjects((current) => current.map((project) => project.project_id === updated.project_id ? updated : project));
      setProjectEditOpen(false);
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename project.");
    }
  }

  async function onDeleteProject() {
    if (!projectId || !window.confirm("Delete this project? Its notes will stay in History.")) return;
    try {
      await deleteProject(projectId);
      setProjects((current) => current.filter((project) => project.project_id !== projectId));
      setProjectId("");
      setProjectEditOpen(false);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete project.");
    }
  }

  const [items, setItems] = useState<JobCreateResponse[]>([]);
  const [facets, setFacets] = useState<HistoryFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(urlQuery);
    setSearch(urlQuery);
  }, [urlQuery]);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const requestId = useRef(0);

  const load = useCallback(
    async (limit: number) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const data = await listHistory({
          projectId: projectId || undefined,
          search,
          sources,
          tags: activeTags,
          dateRange,
          dateFrom: dateRange === "custom" && customFrom ? new Date(customFrom).toISOString() : undefined,
          dateTo: dateRange === "custom" && customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : undefined,
          sort,
          limit,
          offset: 0,
        });
        // Ignore responses from superseded requests so fast filter changes don't flicker.
        if (id !== requestId.current) return;
        setItems(data.items);
        setFacets(data.facets);
        setTotal(data.total);
        setHasMore(data.has_more);
      } catch {
        if (id !== requestId.current) return;
        setError("We could not load your history. Please try again.");
        setItems([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [search, sources, activeTags, dateRange, customFrom, customTo, sort, projectId]
  );

  // Any filter change resets paging back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, sources, activeTags, dateRange, customFrom, customTo, sort, projectId]);

  useEffect(() => {
    void load(visibleCount);
  }, [load, visibleCount]);

  function toggleSource(value: HistorySource) {
    setSources((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
    );
  }

  function toggleTag(tag: string) {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]
    );
  }

  const popularTags = facets?.popular_tags ?? [];
  const emptyLibrary = (facets?.total_library ?? 0) === 0;

  const resultLabel = useMemo(() => {
    if (loading && items.length === 0) return "Loading...";
    if (total === 0) return "No results";
    return `${items.length} of ${total} ${total === 1 ? "report" : "reports"}`;
  }, [loading, items.length, total]);

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-10">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-jetbrains-mono text-xs font-semibold uppercase tracking-widest text-core-outline">
                Activity Log
              </p>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-core-on-surface">
                Analysis History
              </h1>
              <p className="mt-3 max-w-2xl text-lg text-core-on-surface-variant">
                Review and manage your previously processed video insights. Use filters to quickly locate
                specific synthesis reports.
              </p>
            </div>

            <div className="flex rounded-full border border-core-outline-variant/30 bg-core-surface-container p-1">
              {(["list", "grid"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-all ${
                    view === mode
                      ? "bg-core-surface text-core-on-surface shadow-sm"
                      : "text-core-on-surface-variant hover:text-core-on-surface"
                  }`}
                >
                  {mode} View
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-10 lg:flex-row">
            <aside className="w-full shrink-0 space-y-10 lg:w-64">
              <div>
                <FilterHeading>Project</FilterHeading>
                <select aria-label="Filter by project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full rounded-lg border border-core-outline-variant/30 bg-core-surface-container-lowest px-3 py-2 text-sm text-core-on-surface">
                  <option value="">All projects</option>
                  {projectId && !projects.some((project) => project.project_id === projectId) ? <option value={projectId}>Shared project</option> : null}
                  {projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name} ({project.job_count})</option>)}
                </select>
                {projects.some((project) => project.project_id === projectId) ? (
                  <div className="mt-2 space-y-2 text-xs">
                    <button type="button" onClick={() => { setProjectNameDraft(projects.find((project) => project.project_id === projectId)?.name ?? ""); setProjectEditOpen((open) => !open); }} className="font-semibold text-core-primary">Rename project</button>
                    {projectEditOpen ? <div className="flex gap-1"><input aria-label="Rename project" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} maxLength={120} className="min-w-0 flex-1 rounded border px-2 py-1" /><button type="button" onClick={() => void onRenameProject()} className="font-semibold text-core-primary">Save</button></div> : null}
                    <button type="button" onClick={() => void onDeleteProject()} className="block font-semibold text-core-error">Delete project</button>
                  </div>
                ) : null}
              </div>
              <div>
                <FilterHeading>Date Range</FilterHeading>
                <div className="space-y-2">
                  {DATE_RANGES.map((option) => (
                    <label key={option.value} className="group flex cursor-pointer items-center gap-4">
                      <input
                        type="radio"
                        name="date-filter"
                        className="sr-only"
                        checked={dateRange === option.value}
                        onChange={() => setDateRange(option.value)}
                      />
                      <Radio checked={dateRange === option.value} />
                      <span
                        className={`text-sm ${
                          dateRange === option.value
                            ? "text-core-on-surface"
                            : "text-core-on-surface-variant"
                        }`}
                      >
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>

                {dateRange === "custom" ? (
                  <div className="mt-3 animate-fade-in space-y-2 rounded-lg border border-core-outline-variant/25 bg-core-surface-container-lowest p-3">
                    <label className="block">
                      <span className="mb-1 block font-jetbrains-mono text-[10px] font-semibold uppercase tracking-wider text-core-outline">
                        From
                      </span>
                      <input
                        type="date"
                        value={customFrom}
                        max={customTo || undefined}
                        onChange={(event) => setCustomFrom(event.target.value)}
                        className="w-full rounded-lg border border-core-outline-variant/30 bg-core-surface px-2.5 py-1.5 text-sm text-core-on-surface outline-none focus:border-core-primary focus:ring-2 focus:ring-core-primary/15"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block font-jetbrains-mono text-[10px] font-semibold uppercase tracking-wider text-core-outline">
                        To
                      </span>
                      <input
                        type="date"
                        value={customTo}
                        min={customFrom || undefined}
                        onChange={(event) => setCustomTo(event.target.value)}
                        className="w-full rounded-lg border border-core-outline-variant/30 bg-core-surface px-2.5 py-1.5 text-sm text-core-on-surface outline-none focus:border-core-primary focus:ring-2 focus:ring-core-primary/15"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div>
                <FilterHeading>Source</FilterHeading>
                <div className="space-y-2">
                  {SOURCES.map((option) => {
                    const checked = sources.includes(option.value);
                    const count = facets?.source_counts?.[option.value] ?? 0;
                    return (
                      <label key={option.value} className="group flex cursor-pointer items-center gap-4">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleSource(option.value)}
                        />
                        <Checkbox checked={checked} />
                        <span
                          className={`flex-1 text-sm ${
                            checked ? "text-core-on-surface" : "text-core-on-surface-variant"
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="font-jetbrains-mono text-[10px] text-core-outline">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <FilterHeading>Popular Tags</FilterHeading>
                {popularTags.length === 0 ? (
                  <p className="text-sm text-core-on-surface-variant/70">
                    Tags appear here once your videos are analyzed.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {popularTags.map(({ tag, count }) => {
                      const active = activeTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleTag(tag)}
                          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                            active
                              ? "border-core-primary/30 bg-core-primary/10 text-core-primary"
                              : "border-core-outline-variant/30 bg-core-surface-container text-core-on-surface hover:border-core-primary"
                          }`}
                        >
                          {tag}
                          <span className="ml-1.5 font-jetbrains-mono text-[10px] opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {activeTags.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTags([])}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-core-primary hover:underline"
                  >
                    <Icon name="close" className="!text-[14px]" />
                    Clear tag filters
                  </button>
                ) : null}
              </div>
            </aside>

            <div className="min-w-0 flex-1">
              <div className="mb-6 flex flex-col items-center justify-between gap-4 rounded-xl border border-core-outline-variant/20 bg-core-surface p-2 shadow-sm sm:flex-row">
                <div className="relative w-full sm:w-96">
                  <Icon
                    name="search"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 !text-[20px] text-core-outline"
                  />
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search title, summary, or tags..."
                    aria-label="Search analysis history"
                    className="w-full rounded-lg border-none bg-core-surface-container-low py-2 pl-10 pr-4 text-sm text-core-on-surface outline-none transition-shadow placeholder:text-core-on-surface-variant/60 focus:ring-2 focus:ring-core-primary/20"
                  />
                </div>

                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <span className="ml-4 whitespace-nowrap text-sm text-core-on-surface-variant">Sort by:</span>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as HistorySort)}
                    aria-label="Sort analysis history"
                    className="cursor-pointer border-none bg-transparent pr-1 text-sm font-semibold text-core-on-surface outline-none"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <p className="font-jetbrains-mono text-[11px] uppercase tracking-wider text-core-outline">
                  {resultLabel}
                </p>
                {loading && items.length > 0 ? (
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-core-primary border-t-transparent"
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              {error ? (
                <div className="rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
                  {error}
                </div>
              ) : null}

              {loading && items.length === 0 ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="flex animate-pulse flex-col gap-5 rounded-xl border border-core-outline-variant/20 bg-core-surface p-4 sm:flex-row"
                    >
                      <div className="h-32 w-full rounded-lg bg-core-surface-container sm:w-48" />
                      <div className="flex-1 space-y-3 py-1">
                        <div className="h-4 w-2/3 rounded bg-core-surface-container" />
                        <div className="h-3 w-full rounded bg-core-surface-container" />
                        <div className="h-3 w-5/6 rounded bg-core-surface-container" />
                        <div className="h-5 w-40 rounded-full bg-core-surface-container" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {!loading && items.length === 0 && !error ? (
                <div className="rounded-xl border border-dashed border-core-outline-variant/40 bg-core-surface px-6 py-16 text-center">
                  <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-core-surface-container-high text-core-on-surface-variant">
                    <Icon name={emptyLibrary ? "video_library" : "filter_alt_off"} className="!text-[24px]" />
                  </span>
                  <p className="font-display text-lg font-semibold text-core-on-surface">
                    {emptyLibrary ? "No analysis reports yet" : "No reports match these filters"}
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-core-on-surface-variant">
                    {emptyLibrary
                      ? "Process your first recording and its synthesis report will show up here."
                      : "Try widening your date range, re-enabling a source, or clearing the search box."}
                  </p>
                  {emptyLibrary ? (
                    <Link
                      href="/"
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-core-primary px-4 py-2.5 text-sm font-semibold text-core-on-primary transition hover:bg-core-surface-tint"
                    >
                      <Icon name="add" className="!text-[18px]" />
                      New Note
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {items.length > 0 ? (
                view === "list" ? (
                  <div className="space-y-4">
                    {items.map((job) => (
                      <HistoryRow key={job.job_id} job={job} />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((job) => (
                      <HistoryCard key={job.job_id} job={job} />
                    ))}
                  </div>
                )
              ) : null}

              {hasMore ? (
                <div className="mt-12 flex justify-center">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                    className="flex items-center gap-2 rounded-full border border-core-outline-variant/30 bg-core-surface-container px-12 py-3 text-sm font-semibold text-core-on-surface transition-colors hover:bg-core-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Loading..." : "Load More History"}
                    <Icon name="expand_more" className="!text-[18px]" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <AuthGuard>
      <HistoryPageContent />
    </AuthGuard>
  );
}

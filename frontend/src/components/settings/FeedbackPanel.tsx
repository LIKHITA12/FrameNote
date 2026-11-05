"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { getFeedbackMeta, listCommunityFeedback, submitFeedback } from "@/lib/api";
import { FeedbackItem, FeedbackMetaResponse, FeedbackSummary } from "@/types/job";

const MIN_COMMENT_LENGTH = 10;
const MAX_COMMENT_LENGTH = 1000;
const PAGE_SIZE = 5;

// Mirrors the input styling of the Settings page so the tab reads as one form.
const inputClass =
  "w-full rounded-lg border border-core-outline-variant/35 bg-core-surface-container-low px-3.5 py-2.5 text-sm text-core-on-surface outline-none transition focus:border-core-primary focus:bg-core-surface-container-lowest focus:ring-[3px] focus:ring-core-primary/10";

const cardClass =
  "rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function Stars({ rating, className = "!text-[14px]" }: { rating: number; className?: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Icon
          key={star}
          name="star"
          className={`${className} ${
            star <= rating ? "text-state-warning [font-variation-settings:'FILL'_1]" : "text-core-outline-variant"
          }`}
        />
      ))}
    </span>
  );
}

/** The only input besides the comment box: a 1-5 star picker. */
function StarPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;

  return (
    <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} out of 5`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(0)}
          className={`rounded transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-core-primary focus-visible:ring-offset-1 ${
            star <= shown ? "text-state-warning" : "text-core-outline-variant"
          }`}
        >
          <Icon
            name="star"
            className={`!text-[34px] ${star <= shown ? "[font-variation-settings:'FILL'_1]" : ""}`}
          />
        </button>
      ))}
    </div>
  );
}

/** Average, total, and a per-star bar chart across everyone's ratings. */
function SummaryStrip({ summary }: { summary: FeedbackSummary }) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="shrink-0 text-center sm:pr-5 sm:text-left">
        <p className="font-display text-4xl font-extrabold leading-none text-core-on-surface">
          {summary.average_rating.toFixed(1)}
        </p>
        <div className="mt-1.5 flex justify-center sm:justify-start">
          <Stars rating={Math.round(summary.average_rating)} className="!text-[16px]" />
        </div>
        <p className="mt-1 text-xs text-core-on-surface-variant">
          {summary.total} {summary.total === 1 ? "rating" : "ratings"}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.distribution[String(star)] ?? 0;
          const percent = summary.total ? (count / summary.total) * 100 : 0;
          return (
            <div key={star} className="flex items-center gap-2.5">
              <span className="w-3 shrink-0 font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                {star}
              </span>
              <Icon name="star" className="!text-[12px] shrink-0 text-core-outline-variant" />
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-core-outline-variant/40">
                <div
                  className="h-full rounded-full bg-state-warning transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) ?? "?";
  return letters.toUpperCase();
}

function FeedbackRow({ entry }: { entry: FeedbackItem }) {
  return (
    <li className="flex gap-3.5 border-b border-core-outline-variant/15 py-4 last:border-0 last:pb-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-core-primary-fixed font-jetbrains-mono text-[11px] font-bold text-core-primary">
        {initials(entry.author)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-core-on-surface">{entry.author}</span>
          {entry.is_mine ? (
            <span className="rounded bg-core-primary-fixed px-1.5 py-0.5 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-primary">
              You
            </span>
          ) : null}
          <Stars rating={entry.rating} />
          <span className="ml-auto font-jetbrains-mono text-[11px] text-core-on-surface-variant">
            {new Date(entry.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-line text-sm text-core-on-surface-variant">{entry.comment}</p>
        {entry.is_mine && entry.status && entry.status !== "new" ? (
          <span className="mt-2 inline-block rounded bg-state-success-soft px-2 py-0.5 font-jetbrains-mono text-[10px] font-semibold uppercase tracking-wider text-state-on-success-soft">
            {entry.status}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Settings > Feedback: rate FrameNote, then read what everyone else said. */
export function FeedbackPanel() {
  const [meta, setMeta] = useState<FeedbackMetaResponse | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await getFeedbackMeta();
      setMeta(data);
      setItems(data.community.items);
      setSummary(data.community.summary);
      setHasMore(data.community.has_more);
      setLoadError(null);
    } catch {
      setLoadError("We could not load feedback. Please refresh the page.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Let the thank-you clear itself rather than sitting on screen.
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const ratingWord = useMemo(() => meta?.rating_labels[String(rating)] ?? "", [meta, rating]);
  const tooShort = comment.length > 0 && comment.trim().length < MIN_COMMENT_LENGTH;
  const canSubmit = rating > 0 && comment.trim().length >= MIN_COMMENT_LENGTH && !submitting;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitFeedback({ rating, comment: comment.trim() });
      setSuccessMessage(response.message);
      setRating(0);
      setComment("");
      await reload();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "We could not send your feedback. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onShowMore() {
    setLoadingMore(true);
    try {
      const next = await listCommunityFeedback(PAGE_SIZE, items.length);
      // Guard against a duplicate row if someone posted while this page was open.
      setItems((current) => {
        const seen = new Set(current.map((entry) => entry.feedback_id));
        return [...current, ...next.items.filter((entry) => !seen.has(entry.feedback_id))];
      });
      setHasMore(next.has_more);
      setSummary(next.summary);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
        {loadError}
      </div>
    );
  }

  if (!meta || !summary) {
    return (
      <div className="h-80 animate-pulse rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest" />
    );
  }

  return (
    <>
      {/* --- the form: two questions, nothing else ---------------------------- */}
      <section className={cardClass}>
        <header className="mb-5 flex items-start gap-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-core-primary-fixed text-core-primary">
            <Icon name="rate_review" className="!text-[20px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold text-core-on-surface">Rate FrameNote</h2>
            <p className="mt-0.5 text-sm text-core-on-surface-variant">
              Two quick things, and it helps us decide what to build next.
            </p>
          </div>
          {meta.my_submitted_count > 0 ? (
            <span className="shrink-0 rounded bg-core-surface-container-high px-2.5 py-1 font-jetbrains-mono text-[11px] font-semibold text-core-on-surface-variant">
              {meta.my_submitted_count} sent
            </span>
          ) : null}
        </header>

        {successMessage ? (
          <div
            role="status"
            className="mb-5 flex items-start gap-2 rounded-xl border border-state-success/30 bg-state-success-soft px-4 py-3 text-sm text-state-on-success-soft"
          >
            <Icon name="check_circle" className="!text-[18px] mt-px shrink-0" />
            {successMessage}
          </div>
        ) : null}
        {submitError ? (
          <div className="mb-5 rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
            {submitError}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4">
            <StarPicker value={rating} onChange={setRating} />
            <span className="font-display text-base font-bold text-core-on-surface">
              {ratingWord || (
                <span className="text-sm font-normal text-core-on-surface-variant">
                  Tap a star to rate
                </span>
              )}
            </span>
          </div>

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-core-on-surface">Tell us why</span>
              <span
                className={`font-jetbrains-mono text-[11px] ${
                  tooShort ? "text-core-error" : "text-core-on-surface-variant"
                }`}
              >
                {comment.length} / {MAX_COMMENT_LENGTH}
              </span>
            </span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
              rows={3}
              placeholder="What worked well, or what got in your way?"
              className={`${inputClass} resize-y`}
            />
            {tooShort ? (
              <span className="mt-1 block text-xs text-core-error">
                Please add at least {MIN_COMMENT_LENGTH} characters.
              </span>
            ) : null}
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-core-on-surface-variant">
              <Icon name="visibility" className="!text-[14px]" />
              Your rating and comment appear in the list below, with your first name.
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-xl bg-core-primary px-5 py-2.5 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon
                name={submitting ? "autorenew" : "send"}
                className={`!text-[18px] ${submitting ? "animate-spin" : ""}`}
              />
              {submitting ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>

      {/* --- what everyone else said ------------------------------------------ */}
      <section className={cardClass}>
        <header className="mb-5 flex items-start gap-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-core-primary-fixed text-core-primary">
            <Icon name="groups" className="!text-[20px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold text-core-on-surface">What other users say</h2>
            <p className="mt-0.5 text-sm text-core-on-surface-variant">
              Ratings and comments from across FrameNote, newest first.
            </p>
          </div>
        </header>

        {summary.total === 0 ? (
          <div className="rounded-lg border border-dashed border-core-outline-variant/40 bg-core-surface-container-low px-4 py-10 text-center">
            <Icon name="reviews" className="!text-[32px] text-core-outline" />
            <p className="mt-2 text-sm font-semibold text-core-on-surface">No ratings yet</p>
            <p className="text-sm text-core-on-surface-variant">Be the first to rate FrameNote.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-5">
              <SummaryStrip summary={summary} />
            </div>

            <ul className="mt-2">
              {items.map((entry) => (
                <FeedbackRow key={entry.feedback_id} entry={entry} />
              ))}
            </ul>

            {hasMore ? (
              <button
                type="button"
                onClick={() => void onShowMore()}
                disabled={loadingMore}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-core-outline-variant/30 px-4 py-2.5 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container-high hover:text-core-on-surface disabled:opacity-60"
              >
                <Icon
                  name={loadingMore ? "autorenew" : "expand_more"}
                  className={`!text-[18px] ${loadingMore ? "animate-spin" : ""}`}
                />
                {loadingMore ? "Loading..." : `Show more (${summary.total - items.length} left)`}
              </button>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

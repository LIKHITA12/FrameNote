"use client";

import { useMemo, useState } from "react";

import { DetailedKeyMoment } from "@/types/job";

interface DetailedKeyMomentsProps {
  moments: DetailedKeyMoment[];
  loading: boolean;
  error: string | null;
  query: string;
  activeTimestamp: number | null;
  onJump: (seconds: number) => void;
}

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

function MomentFrame({ moment }: { moment: DetailedKeyMoment }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!moment.frame_image_url || imageFailed) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-core-outline-variant/50 bg-core-surface-container-lowest text-core-outline">
        <Icon name="image_not_supported" className="!text-[28px]" />
        <span className="text-[12px] font-medium">Frame capture unavailable for this moment</span>
      </div>
    );
  }

  return (
    <img
      src={moment.frame_image_url}
      alt={`Frame captured for ${moment.title}`}
      loading="lazy"
      onError={() => setImageFailed(true)}
      className="aspect-video w-full rounded-xl border border-core-outline-variant/25 bg-black object-contain"
    />
  );
}

export function DetailedKeyMoments({
  moments,
  loading,
  error,
  query,
  activeTimestamp,
  onJump,
}: DetailedKeyMomentsProps) {
  const filteredMoments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return moments;
    }
    return moments.filter((moment) =>
      `${moment.title} ${moment.bullets.join(" ")}`.toLowerCase().includes(normalized)
    );
  }, [moments, query]);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-core-outline-variant/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-core-primary-fixed text-core-primary">
            <Icon name="photo_library" className="!text-[20px]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-[18px] font-bold text-core-on-surface">Key moments &amp; slide captures</h3>
              <span className="rounded-full bg-core-primary px-2 py-0.5 font-jetbrains-mono text-[10px] font-bold uppercase tracking-[0.05em] text-core-on-primary">
                Pro
              </span>
            </div>
            <p className="text-[13px] text-core-on-surface-variant">Complete synchronized frames and discussion details</p>
          </div>
        </div>
        <span className="rounded-full bg-core-surface-container-high px-2.5 py-1 font-jetbrains-mono text-[11px] font-semibold text-core-primary">
          {filteredMoments.length} key frames
        </span>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-core-on-surface-variant" aria-live="polite">
          <Icon name="progress_activity" className="animate-spin !text-[20px]" />
          Loading detailed moments…
        </div>
      ) : error ? (
        <div className="rounded-xl bg-state-danger-soft px-4 py-6 text-center text-sm text-state-on-danger-soft" role="alert">
          {error}
        </div>
      ) : filteredMoments.length === 0 ? (
        <div className="py-8 text-center text-sm text-core-on-surface-variant">
          {moments.length ? "No detailed moments match this search." : "No detailed moments are available for this recording."}
        </div>
      ) : (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto overscroll-contain pr-2">
          {filteredMoments.map((moment, index) => {
            const active = activeTimestamp === moment.frame_timestamp_seconds;
            return (
              <article
                key={`${moment.start_seconds}-${moment.end_seconds}-${moment.title}`}
                className={`flex flex-col gap-4 rounded-xl p-4 transition-all ${
                  active
                    ? "bg-core-surface-container ring-2 ring-core-primary/35"
                    : "bg-core-surface-container-low hover:bg-core-surface-container"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-core-primary px-2.5 py-0.5 font-jetbrains-mono text-[11px] font-bold text-core-on-primary">
                        {toClock(moment.start_seconds)}–{toClock(moment.end_seconds)}
                      </span>
                      <span className="font-jetbrains-mono text-[11px] font-semibold text-core-outline">
                        Moment {index + 1}
                      </span>
                    </div>
                    <h4 className="mt-2 text-[16px] font-bold leading-snug text-core-on-surface">{moment.title}</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJump(moment.frame_timestamp_seconds)}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-core-surface-container-lowest px-3 text-[12px] font-semibold text-core-primary shadow-sm transition-all hover:bg-core-primary hover:text-core-on-primary"
                  >
                    <Icon name="play_arrow" className="!text-[16px]" />
                    Jump to frame
                  </button>
                </div>

                <MomentFrame moment={moment} />

                <ul className="space-y-2 rounded-xl bg-core-surface-container-lowest px-4 py-3">
                  {moment.bullets.map((bullet, bulletIndex) => (
                    <li
                      key={`${moment.start_seconds}-bullet-${bulletIndex}`}
                      className="flex items-start gap-2 text-sm leading-relaxed text-core-on-surface-variant"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-core-primary" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

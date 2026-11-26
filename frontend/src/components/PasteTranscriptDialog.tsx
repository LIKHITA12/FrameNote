"use client";

import { FormEvent, useEffect, useState } from "react";

import { useProcessing } from "@/components/ProcessingContext";
import { createJobFromPastedTranscript } from "@/lib/api";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const MIN_TRANSCRIPT_CHARS = 50;
const MAX_TRANSCRIPT_CHARS = 500_000;

/**
 * Fallback for videos FrameNote can't read itself (for example a YouTube video whose captions are
 * blocked): the user copies the transcript from YouTube and pastes it here. Rendered once in the
 * root layout and opened from anywhere through useProcessing().openPasteTranscript(url).
 */
export function PasteTranscriptDialog() {
  const { pasteTranscriptUrl, closePasteTranscript, startProcessing } = useProcessing();
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pasteTranscriptUrl !== null) {
      setUrl(pasteTranscriptUrl);
      setTranscript("");
      setError(null);
    }
  }, [pasteTranscriptUrl]);

  if (pasteTranscriptUrl === null) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanUrl = url.trim();
    const cleanTranscript = transcript.trim();
    if (!cleanUrl) {
      setError("Add the video link, so your note links back to the video.");
      return;
    }
    if (cleanTranscript.length < MIN_TRANSCRIPT_CHARS) {
      setError("That transcript looks too short. Paste the full transcript text.");
      return;
    }
    if (cleanTranscript.length > MAX_TRANSCRIPT_CHARS) {
      setError("That transcript is too long. Paste a transcript under 500,000 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // The dialog stays open until the job exists, so an error keeps everything the user typed.
      const job = await createJobFromPastedTranscript(cleanUrl, cleanTranscript);
      closePasteTranscript();
      startProcessing(job.job_id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't start that note. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-[28px] border border-core-primary/10 bg-core-surface p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-core-primary-fixed text-core-primary">
            <Icon name="content_paste" className="!text-[22px]" />
          </div>
          <button
            type="button"
            onClick={closePasteTranscript}
            className="flex h-8 w-8 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container"
            title="Close"
          >
            <Icon name="close" className="!text-[18px]" />
          </button>
        </div>

        <h2 className="mt-4 text-lg font-bold tracking-tight text-core-on-surface">Paste the transcript</h2>
        <p className="mt-1 text-[13px] text-core-on-surface-variant">
          We&apos;ll turn it into the same notes, key moments and PDF. Timestamps are kept when you paste them.
        </p>

        <details className="mt-3 rounded-xl bg-core-surface-container-low px-4 py-3 text-xs text-core-on-surface-variant">
          <summary className="cursor-pointer font-semibold text-core-on-surface">How to copy a YouTube transcript</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Open the video on youtube.com and click <strong>…more</strong> under the title.</li>
            <li>Scroll down and click <strong>Show transcript</strong>.</li>
            <li>Select all the transcript text in the panel, copy it, and paste it below.</li>
          </ol>
        </details>

        <label className="mt-4 text-xs font-semibold text-core-on-surface-variant" htmlFor="paste-transcript-url">
          Video link
        </label>
        <input
          id="paste-transcript-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="mt-1 rounded-xl border border-core-outline-variant/40 bg-core-surface-container-lowest px-3 py-2.5 text-sm text-core-on-surface outline-none focus:border-core-primary"
        />

        <label className="mt-4 text-xs font-semibold text-core-on-surface-variant" htmlFor="paste-transcript-text">
          Transcript
        </label>
        <textarea
          id="paste-transcript-text"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder={"0:00\nHere's what we'll cover today…\n0:05\n…"}
          rows={10}
          className="mt-1 min-h-[160px] flex-1 resize-y rounded-xl border border-core-outline-variant/40 bg-core-surface-container-lowest px-3 py-2.5 font-mono text-xs text-core-on-surface outline-none focus:border-core-primary"
        />
        <p className="mt-1 text-right text-[11px] text-core-outline">{transcript.trim().length.toLocaleString()} characters</p>

        {error ? <p className="mt-2 text-xs font-medium text-state-on-danger-soft">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={closePasteTranscript}
            className="flex-1 rounded-xl border border-core-outline-variant/40 px-4 py-2.5 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-core-primary px-4 py-2.5 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Create notes"}
          </button>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const ACCEPTED_EXTENSIONS = [".vtt", ".srt", ".docx", ".txt", ".md"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

function hasSupportedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface TranscriptSourceDialogProps {
  videoLabel?: string | null;
  onCancel: () => void;
  /** transcriptFile is null when the user has no transcript file (fall back to auto-transcription). */
  onConfirm: (transcriptFile: File | null) => void;
}

/**
 * Asked right after a video is selected for upload: does the user already have a transcript
 * file (e.g. a Teams "Download transcript" .docx or .vtt captions export) they'd rather use
 * verbatim instead of letting FrameNote auto-transcribe the audio?
 */
export function TranscriptSourceDialog({ videoLabel, onCancel, onConfirm }: TranscriptSourceDialogProps) {
  const [hasTranscript, setHasTranscript] = useState<boolean | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    if (!hasSupportedExtension(file.name)) {
      setError("Unsupported file type. Please choose a .vtt, .srt, .docx, .txt, or .md file.");
      setTranscriptFile(null);
      return;
    }
    setError(null);
    setTranscriptFile(file);
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-core-primary/10 bg-core-surface p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-core-primary-fixed text-core-primary">
            <Icon name="subject" className="!text-[22px]" />
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container"
            title="Cancel"
          >
            <Icon name="close" className="!text-[18px]" />
          </button>
        </div>

        <h2 className="mt-4 text-lg font-bold tracking-tight text-core-on-surface">
          Do you already have a transcript?
        </h2>
        <p className="mt-1 truncate text-[13px] font-medium text-core-on-surface-variant">
          {videoLabel ? `For ${videoLabel}` : "If you have an exported transcript (e.g. Teams), we'll use it verbatim."}
        </p>

        {hasTranscript !== true ? (
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => setHasTranscript(true)}
              className="flex items-center justify-between gap-3 rounded-xl border border-core-outline-variant/30 bg-core-surface-container-lowest px-4 py-3 text-left transition hover:border-core-primary/40 hover:bg-core-primary/5"
            >
              <span>
                <span className="block text-sm font-semibold text-core-on-surface">Yes, I have a transcript file</span>
                <span className="block text-xs text-core-on-surface-variant">Upload it and we&apos;ll use it instead of auto-transcribing</span>
              </span>
              <Icon name="upload_file" className="!text-[20px] text-core-primary" />
            </button>
            <button
              type="button"
              onClick={() => onConfirm(null)}
              className="flex items-center justify-between gap-3 rounded-xl border border-core-outline-variant/30 bg-core-surface-container-lowest px-4 py-3 text-left transition hover:border-core-primary/40 hover:bg-core-primary/5"
            >
              <span>
                <span className="block text-sm font-semibold text-core-on-surface">No, transcribe it for me</span>
                <span className="block text-xs text-core-on-surface-variant">We&apos;ll generate the transcript automatically, as usual</span>
              </span>
              <Icon name="auto_awesome" className="!text-[20px] text-core-primary" />
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={onFileSelected}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-core-outline-variant/40 bg-core-surface-container-lowest px-4 py-6 text-center transition hover:border-core-primary/50"
            >
              <Icon name="upload_file" className="!text-[26px] text-core-primary" />
              <span className="text-sm font-semibold text-core-on-surface">
                {transcriptFile ? transcriptFile.name : "Choose transcript file"}
              </span>
              <span className="text-xs text-core-on-surface-variant">Supports .vtt, .srt, .docx, .txt, .md</span>
            </button>
            {error ? <p className="mt-2 text-xs font-medium text-state-on-danger-soft">{error}</p> : null}

            <div className="mt-5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setHasTranscript(null);
                  setTranscriptFile(null);
                  setError(null);
                }}
                className="flex-1 rounded-xl border border-core-outline-variant/40 px-4 py-2.5 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!transcriptFile}
                onClick={() => transcriptFile && onConfirm(transcriptFile)}
                className="flex-1 rounded-xl bg-core-primary px-4 py-2.5 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

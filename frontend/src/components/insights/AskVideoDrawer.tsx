"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import { askVideoQuestion, getVideoChat } from "@/lib/api";
import { VideoChatContext, VideoChatMessage, VideoChatUsage } from "@/types/job";

const SUGGESTED_QUESTIONS = [
  "What were the main decisions?",
  "List the unresolved questions.",
  "What are the next action items?",
  "Create a short follow-up email.",
];

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

export function AskVideoDrawer({
  jobId,
  title,
  open,
  onClose,
  onJump,
  selectedContexts,
  onRemoveContext,
}: {
  jobId: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onJump: (seconds: number) => void;
  selectedContexts: VideoChatContext[];
  onRemoveContext: (index: number) => void;
}) {
  const [messages, setMessages] = useState<VideoChatMessage[]>([]);
  const [usage, setUsage] = useState<VideoChatUsage | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setUsage(null);
    setQuestion("");
    void getVideoChat(jobId)
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
        setUsage(response.usage);
        setAiConfigured(response.ai_configured);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load this conversation.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, open]);

  async function submitQuestion(value = question) {
    const clean = value.trim();
    if (!clean || sending || !aiConfigured) return;
    setSending(true);
    setError(null);
    setQuestion("");
    try {
      const response = await askVideoQuestion(jobId, clean, selectedContexts);
      setMessages((current) => [...current, response.user_message, response.assistant_message]);
      setUsage(response.usage);
    } catch (submitError) {
      setQuestion(clean);
      setError(submitError instanceof Error ? submitError.message : "The AI assistant could not answer right now.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitQuestion();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion();
    }
  }

  if (!open) return null;

  const exhausted = usage ? usage.remaining_this_month <= 0 || (usage.per_video_limit != null && usage.used_for_video >= usage.per_video_limit) : false;

  return (
      <aside className="fixed inset-y-0 right-0 z-[130] flex w-full flex-col border-l border-core-outline-variant/20 bg-core-surface-container-lowest shadow-[-10px_0_30px_rgba(15,23,42,0.10)] sm:w-[420px]" aria-labelledby="ask-video-title">
        <header className="flex items-start justify-between gap-3 border-b border-core-outline-variant/20 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-core-primary text-core-on-primary shadow-sm">
              <Icon name="auto_awesome" className="!text-[21px]" />
            </span>
            <div className="min-w-0">
              <h2 id="ask-video-title" className="font-display text-lg font-bold text-core-on-surface">Ask this video</h2>
              <p className="truncate text-[12px] text-core-on-surface-variant">Transcript-grounded assistant · {title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-core-on-surface-variant hover:bg-core-surface-container" aria-label="Close">
            <Icon name="close" className="!text-[20px]" />
          </button>
        </header>

        {usage ? (
          <div className="flex items-center justify-between gap-3 border-b border-core-outline-variant/15 bg-core-surface-container-low px-5 py-2.5 text-[11px] text-core-on-surface-variant">
            <span>{usage.remaining_this_month} of {usage.monthly_limit} questions left this month</span>
            {usage.per_video_limit != null ? <span>{usage.used_for_video}/{usage.per_video_limit} used for this video</span> : <span>Pro allowance</span>}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-core-on-surface-variant">
              <Icon name="progress_activity" className="animate-spin !text-[20px]" />
              Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-core-primary-fixed text-core-primary">
                <Icon name="auto_awesome" className="!text-[28px]" />
              </div>
              <h3 className="mt-4 text-center text-base font-bold text-core-on-surface">Explore the recording</h3>
              <p className="mx-auto mt-1 max-w-sm text-center text-sm leading-relaxed text-core-on-surface-variant">
                Answers use only this video&apos;s transcript. Timestamp links jump directly to the supporting moment.
              </p>
              <div className="mt-5 grid gap-2">
                {SUGGESTED_QUESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => void submitQuestion(suggestion)} disabled={!aiConfigured || exhausted} className="flex items-center justify-between gap-3 rounded-xl border border-core-outline-variant/20 bg-core-surface-container-low p-3 text-left text-sm font-semibold text-core-on-surface transition hover:border-core-primary/40 hover:bg-core-primary-fixed disabled:cursor-not-allowed disabled:opacity-50">
                    {suggestion}
                    <Icon name="arrow_forward" className="shrink-0 !text-[17px] text-core-primary" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div key={message.message_id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${message.role === "user" ? "rounded-br-md bg-core-primary text-core-on-primary" : "rounded-bl-md bg-core-surface-container-low text-core-on-surface"}`}>
                    {message.contexts.length ? (
                      <div className={`mb-2 flex flex-wrap gap-1.5 ${message.role === "user" ? "text-core-on-primary" : "text-core-primary"}`}>
                        {message.contexts.map((context, index) => (
                          <span key={`${message.message_id}-${context.context_id}-${index}`} title={context.selected_text ?? undefined} className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-bold">
                            <Icon name="tag" className="!text-[12px]" />
                            {context.label}{context.selected_text ? `: “${context.selected_text.slice(0, 24)}${context.selected_text.length > 24 ? "…" : ""}”` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                    {message.citations.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-core-outline-variant/20 pt-2.5">
                        {message.citations.map((citation, index) => (
                          <button key={`${message.message_id}-${citation.timestamp_seconds}-${index}`} type="button" onClick={() => onJump(citation.timestamp_seconds)} title={citation.excerpt} className="flex items-center gap-1 rounded-lg bg-core-surface-container-lowest px-2 py-1 font-jetbrains-mono text-[11px] font-bold text-core-primary shadow-sm hover:bg-core-primary hover:text-core-on-primary">
                            <Icon name="play_arrow" className="!text-[13px]" />
                            {citation.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {sending ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-core-surface-container-low px-4 py-3 text-sm text-core-on-surface-variant">
                    <Icon name="progress_activity" className="animate-spin !text-[17px] text-core-primary" />
                    Looking through the transcript…
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className="border-t border-core-outline-variant/20 bg-core-surface-container-lowest p-4">
          {!aiConfigured ? (
            <div className="mb-3 rounded-xl bg-state-warning-soft px-3 py-2 text-[12px] font-medium text-state-on-warning-soft">
              AI chat needs an OpenAI, Gemini, or configured Azure credential on the backend.
            </div>
          ) : null}
          {error ? <div className="mb-3 rounded-xl bg-state-danger-soft px-3 py-2 text-[12px] font-medium text-state-on-danger-soft">{error}</div> : null}
          {exhausted ? (
            <div className="mb-3 rounded-xl bg-core-primary-fixed px-3 py-2 text-[12px] font-medium text-core-primary">
              You have reached the available chat allowance. Upgrade or wait for the next monthly reset.
            </div>
          ) : null}
          {selectedContexts.length ? (
            <div className="mb-2">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-core-outline">
                <span>Attached to your next question</span>
                <span className="font-jetbrains-mono font-semibold">{selectedContexts.length}/8 contexts</span>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {selectedContexts.map((context, index) => (
                  <span key={`${context.context_id}-${context.selected_text ?? "section"}-${index}`} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-core-primary/20 bg-core-primary-fixed px-2.5 py-1.5 text-[11px] font-bold text-core-primary" title={context.selected_text ?? undefined}>
                    <Icon name="tag" className="shrink-0 !text-[14px]" />
                    <span className="truncate">
                      {context.label}{context.selected_text ? `: “${context.selected_text.slice(0, 32)}${context.selected_text.length > 32 ? "…" : ""}”` : ""}
                    </span>
                    <button type="button" onClick={() => onRemoveContext(index)} className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-core-primary/10" aria-label={`Remove ${context.label} context`}>
                      <Icon name="close" className="!text-[12px]" />
                    </button>
                  </span>
                ))}
              </div>
              {selectedContexts.length >= 8 ? <p className="mt-1 text-[10px] font-medium text-core-primary">Context limit reached. Remove a tag to attach another selection.</p> : null}
            </div>
          ) : null}
          <form onSubmit={onSubmit} className="rounded-2xl border border-core-outline-variant/30 bg-core-surface-container-low p-2 focus-within:border-core-primary/60 focus-within:ring-2 focus-within:ring-core-primary/10">
            <textarea ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 500))} onKeyDown={onInputKeyDown} rows={2} placeholder="Ask a question about this video…" disabled={sending || !aiConfigured || exhausted} className="max-h-32 w-full resize-none bg-transparent px-2 py-1 text-sm text-core-on-surface outline-none placeholder:text-core-outline disabled:cursor-not-allowed" />
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <span className="text-[10px] text-core-outline">{question.length}/500 · Enter to send</span>
              <button type="submit" disabled={!question.trim() || sending || !aiConfigured || exhausted} className="flex h-8 items-center gap-1.5 rounded-xl bg-core-primary px-3 text-[12px] font-semibold text-core-on-primary transition hover:bg-core-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
                <Icon name="send" className="!text-[15px]" />
                Ask
              </button>
            </div>
          </form>
          <p className="mt-2 text-center text-[10px] text-core-outline">Answers may be imperfect. Verify important details against the cited moment.</p>
        </footer>
      </aside>
  );
}

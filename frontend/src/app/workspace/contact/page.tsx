"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { Footer } from "@/components/Footer";
import { AuthGuard } from "@/components/AuthGuard";
import { useSidebar } from "@/components/SidebarContext";
import { Accordion } from "@/components/ui/Accordion";
import { getSupportMeta, sendContactMessage } from "@/lib/api";
import { SupportMetaResponse } from "@/types/job";

const MESSAGE_LIMIT = 1200;

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const inputClass =
  "w-full rounded-lg border border-core-outline-variant/30 bg-core-surface-container-low py-2.5 pl-10 pr-3.5 text-sm text-core-on-surface outline-none transition placeholder:text-core-on-surface-variant/60 focus:border-core-primary focus:bg-core-surface-container-lowest focus:ring-[3px] focus:ring-core-primary/10";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-jetbrains-mono text-xs font-semibold uppercase tracking-wide text-core-on-surface">
      {children}
    </span>
  );
}

function ChannelCard({ channel }: { channel: SupportMetaResponse["channels"][number] }) {
  return (
    <div className="rounded-xl border border-core-outline-variant/15 bg-core-surface-container-low p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-core-outline-variant/20 bg-core-surface text-core-primary">
          <Icon name={channel.icon} className="!text-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-core-on-surface">{channel.name}</span>
            {channel.badge ? (
              <span className="rounded bg-core-primary-fixed px-2 py-0.5 font-jetbrains-mono text-[10px] font-semibold text-core-primary">
                {channel.badge}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm text-core-on-surface-variant">{channel.description}</p>
        </div>
      </div>

      {channel.email || channel.meta ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-12">
          {channel.email ? (
            <a
              href={`mailto:${channel.email}`}
              className="inline-flex items-center gap-1 font-jetbrains-mono text-xs font-semibold text-core-primary hover:underline"
            >
              {channel.email}
              <Icon name="north_east" className="!text-[14px]" />
            </a>
          ) : (
            <span />
          )}
          {channel.meta ? (
            <span className="font-jetbrains-mono text-[11px] text-core-on-surface-variant">{channel.meta}</span>
          ) : null}
        </div>
      ) : null}

      {channel.links.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-12">
          {channel.links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-core-outline-variant/25 bg-core-surface px-3 py-1.5 font-jetbrains-mono text-[11px] font-semibold text-core-on-surface transition hover:border-core-primary/40 hover:text-core-primary"
            >
              <Icon name={link.icon} className="!text-[14px]" />
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContactPageContent() {
  const { collapsed } = useSidebar();

  const [meta, setMeta] = useState<SupportMetaResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("general");
  const [message, setMessage] = useState("");

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSupportMeta()
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        setName((current) => current || data.prefill_name || "");
        setEmail((current) => current || data.prefill_email || "");
        if (data.topics.length > 0) setTopic((current) => current || data.topics[0].value);
      })
      .catch(() => {
        if (!cancelled) setLoadError("We could not load support details. You can still send us a message.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      const result = await sendContactMessage({ name, email, topic, message });
      setSentTo(result.email);
      setMessage("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "We could not send your message.");
    } finally {
      setSending(false);
    }
  }

  const topics = meta?.topics ?? [{ value: "general", label: "General Inquiry & Product Demo" }];
  const status = meta?.status;

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="mx-auto w-full max-w-[1280px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="flex flex-wrap items-start justify-between gap-6 rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-lowest px-6 py-8 sm:px-10">
            <div className="max-w-2xl">
              <p className="mb-2 flex items-center gap-2 font-jetbrains-mono text-xs font-semibold uppercase tracking-widest text-core-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-core-primary" />
                Direct Support & Collaboration
              </p>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-core-on-surface sm:text-5xl">
                Get in Touch
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-core-on-surface-variant">
                Have questions, need custom volume pricing, or want to share product feedback? Our video
                intelligence engineering and support team would love to hear from you.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-core-surface-container-high px-5 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-core-primary-container text-core-on-primary">
                <Icon name="bolt" className="!text-[20px]" />
              </span>
              <div>
                <p className="font-jetbrains-mono text-[11px] uppercase tracking-wide text-core-on-surface-variant">
                  Typical Reply
                </p>
                <p className="max-w-[140px] font-display text-base font-bold leading-snug text-core-on-surface">
                  {meta?.typical_reply ?? "Manual beta support"}
                </p>
              </div>
            </div>
          </section>

          {loadError ? (
            <div className="rounded-xl border border-state-warning/40 bg-state-warning-soft px-4 py-3 text-sm text-state-on-warning-soft">
              {loadError}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <div className="min-w-0 space-y-6">
              <section className="rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]">
                <header className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-bold text-core-on-surface">Send a Message</h2>
                    <p className="mt-1 text-sm text-core-on-surface-variant">
                      Fill out the details below and we will route your request directly to the appropriate
                      team specialist.
                    </p>
                  </div>
                  <Icon name="mail" className="!text-[24px] shrink-0 text-core-primary" />
                </header>

                {sentTo ? (
                  <div className="mb-5 flex animate-fade-in items-start gap-3 rounded-xl border border-state-success/30 bg-state-success-soft p-4">
                    <Icon name="check_circle" className="!text-[20px] shrink-0 text-state-on-success-soft" />
                    <div>
                      <p className="text-sm font-semibold text-state-on-success-soft">Message sent successfully!</p>
                      <p className="text-sm text-state-on-success-soft">
                        A member of our team will reach out to {sentTo} shortly.
                      </p>
                    </div>
                  </div>
                ) : null}

                {sendError ? (
                  <div className="mb-5 rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
                    {sendError}
                  </div>
                ) : null}

                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel>Your Name</FieldLabel>
                      <span className="relative block">
                        <Icon
                          name="person"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-core-on-surface-variant"
                        />
                        <input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                          maxLength={160}
                          placeholder="Your full name"
                          className={inputClass}
                        />
                      </span>
                    </label>

                    <label className="block">
                      <FieldLabel>Work Email</FieldLabel>
                      <span className="relative block">
                        <Icon
                          name="alternate_email"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-core-on-surface-variant"
                        />
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          required
                          placeholder="you@company.com"
                          className={inputClass}
                        />
                      </span>
                    </label>
                  </div>

                  <label className="block">
                    <FieldLabel>Inquiry Topic</FieldLabel>
                    <span className="relative block">
                      <Icon
                        name="category"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-core-on-surface-variant"
                      />
                      <select
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                        aria-label="Inquiry topic"
                        className={`${inputClass} cursor-pointer appearance-none pr-10`}
                      >
                        {topics.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Icon
                        name="expand_more"
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 !text-[20px] text-core-on-surface-variant"
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2">
                      <FieldLabel>Message & Scope</FieldLabel>
                      <span className="font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                        {message.length} / {MESSAGE_LIMIT}
                      </span>
                    </span>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_LIMIT))}
                      required
                      minLength={10}
                      rows={5}
                      placeholder="Tell us how we can help or what you need regarding video transcription, custom quotas, or API integrations..."
                      className="w-full resize-y rounded-lg border border-core-outline-variant/30 bg-core-surface-container-low px-3.5 py-3 text-sm leading-relaxed text-core-on-surface outline-none transition placeholder:text-core-on-surface-variant/60 focus:border-core-primary focus:bg-core-surface-container-lowest focus:ring-[3px] focus:ring-core-primary/10"
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                    <p className="flex items-center gap-2 text-sm text-core-on-surface-variant">
                      <Icon name="verified" className="!text-[18px] text-core-primary" />
                      {meta?.response_window ?? "We typically respond within 2-4 business hours."}
                    </p>
                    <button
                      type="submit"
                      disabled={sending || message.trim().length < 10}
                      className="flex items-center gap-2 rounded-xl bg-core-primary-container px-6 py-3 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {sending ? "Sending..." : "Send Message"}
                      <Icon
                        name={sending ? "autorenew" : "arrow_forward"}
                        className={`!text-[18px] ${sending ? "animate-spin" : ""}`}
                      />
                    </button>
                  </div>
                </form>
              </section>

              <section className="flex flex-wrap items-start gap-4 rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-low p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-core-outline-variant/25 bg-core-surface text-core-primary">
                  <Icon name="shield_person" className="!text-[20px]" />
                </span>
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-semibold text-core-on-surface">What happens to your message</p>
                  <p className="mt-1 text-sm text-core-on-surface-variant">
                    Your name, email, and message are saved to your FrameNote account so the team can read
                    and reply. Your recordings and transcripts are never attached to a support request.
                  </p>
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]">
                <header className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-2xl font-bold text-core-on-surface">Direct Support</h2>
                  <span className="font-jetbrains-mono text-[11px] uppercase tracking-wide text-core-on-surface-variant">
                    Always On
                  </span>
                </header>
                <div className="space-y-3">
                  {(meta?.channels ?? []).map((channel) => (
                    <ChannelCard key={channel.id} channel={channel} />
                  ))}
                  {!meta ? (
                    <div className="h-24 animate-pulse rounded-xl bg-core-surface-container-low" />
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <h2 className="font-display text-2xl font-bold leading-tight text-core-on-surface">
                    Frequently Asked Questions
                  </h2>
                  <Icon name="quiz" className="!text-[22px] shrink-0 text-core-on-surface-variant" />
                </header>
                <Accordion
                  items={(meta?.faqs ?? []).map((faq) => ({ question: faq.question, answer: faq.answer }))}
                  defaultOpenIndex={0}
                />
              </section>

              {status ? (
                <section className="flex flex-wrap items-center gap-3 rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-low p-5">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      status.operational ? "bg-core-primary" : "bg-core-error"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-core-on-surface">{status.headline}</p>
                    <p className="font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                      {status.detail} • {status.uptime_percent}% Uptime
                    </p>
                  </div>
                  <a
                    href={status.status_page_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-sm font-semibold text-core-primary hover:underline"
                  >
                    Status Page
                  </a>
                </section>
              ) : null}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

export default function ContactPage() {
  return (
    <AuthGuard>
      <ContactPageContent />
    </AuthGuard>
  );
}

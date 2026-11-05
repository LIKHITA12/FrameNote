"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { Footer } from "@/components/Footer";
import { AuthGuard } from "@/components/AuthGuard";
import { FeedbackPanel } from "@/components/settings/FeedbackPanel";
import { useSidebar } from "@/components/SidebarContext";
import {
  changePassword,
  createCheckoutSession,
  deleteAccount,
  getUsageSummary,
  getUserSettings,
  updateUserSettings,
} from "@/lib/api";
import { clearSession } from "@/lib/auth";
import { SelectOption, UsageSummaryResponse, UserSettingsResponse } from "@/types/job";

const TABS = [
  { id: "profile", label: "General & Profile", icon: "badge" },
  { id: "billing", label: "Plan & Billing", icon: "credit_card" },
  { id: "feedback", label: "Feedback", icon: "rate_review" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Mutable slice of the settings payload the form edits locally before saving. */
type Draft = {
  full_name: string;
  role_title: string;
  timezone: string;
};

function toDraft(settings: UserSettingsResponse): Draft {
  return {
    full_name: settings.full_name ?? "",
    role_title: settings.role_title ?? "",
    timezone: settings.timezone,
  };
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest p-6 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]">
      <header className="mb-5 flex items-start gap-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-core-primary-fixed text-core-primary">
          <Icon name={icon} className="!text-[20px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold text-core-on-surface">{title}</h2>
          <p className="mt-0.5 text-sm text-core-on-surface-variant">{description}</p>
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-core-on-surface">{label}</span>
        {hint}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-core-outline-variant/35 bg-core-surface-container-low px-3.5 py-2.5 text-sm text-core-on-surface outline-none transition focus:border-core-primary focus:bg-core-surface-container-lowest focus:ring-[3px] focus:ring-core-primary/10";

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  label: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} cursor-pointer appearance-none pr-10`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="expand_more"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 !text-[20px] text-core-on-surface-variant"
      />
    </div>
  );
}

function Meter({ percent, tone = "primary" }: { percent: number; tone?: "primary" | "neutral" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-core-outline-variant/40">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          tone === "primary" ? "bg-core-primary-container" : "bg-core-on-surface-variant"
        }`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** Radial meter whose filled arc tracks `value` as a fraction of `max`. */
function Gauge({ value, max = 1 }: { value: number; max?: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, value / max));
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90" aria-hidden="true">
      <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="3" className="stroke-core-outline-variant/40" />
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-core-primary transition-[stroke-dashoffset] duration-500"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
      />
    </svg>
  );
}

function TierRail({
  usage,
  onUpgrade,
  upgrading,
}: {
  usage: UsageSummaryResponse | null;
  onUpgrade: () => void;
  upgrading: boolean;
}) {
  const hours = usage?.transcription_hours;
  const storage = usage?.storage_gb;
  // 0 means no completed run has been timed yet, which is different from "instant".
  const measuredSpeed = usage && usage.avg_turn_ratio > 0 ? usage.avg_turn_ratio : null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest p-5 shadow-[0_4px_12px_-6px_rgba(15,23,42,0.12)]">
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="font-jetbrains-mono text-[11px] font-semibold uppercase tracking-wider text-core-on-surface-variant">
            Current Tier
          </p>
          {usage?.plan_price_monthly != null ? (
            <span className="rounded-full bg-core-primary-fixed px-2.5 py-0.5 font-jetbrains-mono text-[11px] font-semibold text-core-primary">
              ${usage.plan_price_monthly} / mo
            </span>
          ) : null}
        </div>
        <p className="font-display text-2xl font-bold text-core-on-surface">
          {usage?.plan_label ?? "Loading..."}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-core-on-surface">Transcription Hours</span>
              <span className="font-jetbrains-mono text-xs text-core-on-surface-variant">
                {hours ? `${hours.used} / ${hours.limit ?? "∞"} ${hours.unit}` : "--"}
              </span>
            </div>
            <Meter percent={hours?.percent ?? 0} />
            <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-core-on-surface-variant">
              <span>{hours ? `${hours.percent}% Consumed` : ""}</span>
              <span>{usage ? `Resets in ${usage.resets_in_days} days` : ""}</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-core-on-surface">Vault Video Storage</span>
              <span className="font-jetbrains-mono text-xs text-core-on-surface-variant">
                {storage ? `${storage.used} / ${storage.limit ?? "∞"} ${storage.unit}` : "--"}
              </span>
            </div>
            <Meter percent={storage?.percent ?? 0} tone="neutral" />
            <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-core-on-surface-variant">
              <span>{storage ? `${storage.percent}% In Use` : ""}</span>
              <span>Does not reset monthly</span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-core-outline-variant/25 bg-core-surface-container-low p-4">
          <div>
            <p className="font-jetbrains-mono text-[10px] font-semibold uppercase tracking-wider text-core-on-surface-variant">
              Model Speed
            </p>
            <p className="font-display text-2xl font-bold text-core-on-surface">
              {measuredSpeed ? `${measuredSpeed}x` : "--"}
            </p>
            <p className="text-xs text-core-on-surface-variant">
              {measuredSpeed
                ? "Processing time vs. video length (lower is faster)"
                : "No completed runs measured yet"}
            </p>
          </div>
          <Gauge value={measuredSpeed ?? 0} />
        </div>

        {usage?.tier === "free" ? (
          <button
            type="button"
            onClick={onUpgrade}
            disabled={upgrading}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-core-primary-container px-4 py-3 text-sm font-semibold text-core-on-primary transition hover:bg-core-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {upgrading ? "Opening checkout..." : "Upgrade to Solo Pro"}
            <Icon name="arrow_forward" className="!text-[18px]" />
          </button>
        ) : null}

        <Link
          href="/upgrade"
          className="mt-3 block text-center text-sm font-medium text-core-on-surface-variant transition hover:text-core-primary"
        >
          Manage Billing & Invoices
        </Link>
      </section>

      <section className="rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-low p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-core-on-surface">
          <Icon name="shield_person" className="!text-[18px] text-core-primary" />
          How your data is handled
        </p>
        <dl className="space-y-2 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-core-on-surface-variant">Transcription</dt>
            <dd className="text-right font-medium text-core-on-surface">Automatic</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-core-on-surface-variant">Summaries</dt>
            <dd className="text-right font-medium text-core-on-surface">
              {usage?.tier === "pro" ? "Detailed AI analysis" : "Standard AI summary"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-core-on-surface-variant">Stored on your account</dt>
            <dd className="text-right font-medium text-core-on-surface">
              {storage ? `${storage.used} ${storage.unit}` : "--"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-core-outline-variant/25 pt-3 text-[13px] leading-relaxed text-core-on-surface-variant">
          Free-plan files are retained for 7 days; Solo Pro files are retained for 90 days during beta.
          Account deletion permanently removes your saved account data.
        </p>
      </section>
    </div>
  );
}

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function SettingsPageContent() {
  const { collapsed } = useSidebar();
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?tab=` makes each section deep-linkable (e.g. from the billing card or a support reply).
  const requestedTab = searchParams.get("tab");

  const [settings, setSettings] = useState<UserSettingsResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(isTabId(requestedTab) ? requestedTab : "profile");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordState, setPasswordState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [settingsData, usageData] = await Promise.all([
        getUserSettings(),
        getUsageSummary().catch(() => null),
      ]);
      setSettings(settingsData);
      setDraft(toDraft(settingsData));
      setUsage(usageData);
      setLoadError(null);
    } catch {
      setLoadError("We could not load your settings. Please refresh the page.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto-clear the "saved" confirmation so it doesn't linger on screen.
  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const dirty = useMemo(() => {
    if (!settings || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  }, [settings, draft]);

  function patch(changes: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateUserSettings({
        full_name: draft.full_name,
        role_title: draft.role_title,
        timezone: draft.timezone,
      });
      setSettings(updated);
      setDraft(toDraft(updated));
      setSavedAt(Date.now());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save your preferences");
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    if (settings) setDraft(toDraft(settings));
    setSaveError(null);
  }

  async function onUpgrade() {
    setUpgrading(true);
    try {
      const { checkout_url } = await createCheckoutSession("pro");
      window.location.href = checkout_url;
    } catch {
      setUpgrading(false);
      setSaveError("We could not open checkout. Please try again.");
    }
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    setChangingPassword(true);
    setPasswordState(null);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordState({ tone: "ok", text: "Password updated." });
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordForm(false);
      void reload();
    } catch (error) {
      setPasswordState({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to change your password",
      });
    } finally {
      setChangingPassword(false);
    }
  }

  async function onDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(deleteConfirm.trim());
      clearSession();
      router.replace("/signup");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete your account");
      setDeleting(false);
    }
  }

  const initials = (settings?.full_name || settings?.email || "?").trim().charAt(0).toUpperCase();
  const passwordChanged = settings?.password_changed_at
    ? new Date(settings.password_changed_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="mx-auto w-full max-w-[1280px] px-4 py-7 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-3xl font-extrabold tracking-tight text-core-on-surface">
                  Settings
                </h1>
                {usage ? (
                  <span className="rounded bg-core-surface-container-high px-2.5 py-1 font-jetbrains-mono text-[11px] font-semibold text-core-on-surface-variant">
                    {usage.plan_label} • {usage.transcription_hours.used} /{" "}
                    {usage.transcription_hours.limit ?? "∞"} hrs transcribed
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-core-on-surface-variant">
                Manage your account credentials, billing details, and send us feedback.
              </p>
            </div>

            {/* The feedback tab is its own form with its own submit button, so the
                preference save/discard controls are hidden while it is open. */}
            <div className={`flex items-center gap-3 ${activeTab === "feedback" ? "hidden" : ""}`}>
              {savedAt ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-state-on-success-soft">
                  <Icon name="check_circle" className="!text-[18px]" />
                  Saved
                </span>
              ) : null}
              <button
                type="button"
                onClick={onDiscard}
                disabled={!dirty || saving}
                className="rounded-xl px-3.5 py-2.5 text-sm font-semibold text-core-on-surface-variant transition hover:bg-core-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={!dirty || saving}
                className="flex items-center gap-2 rounded-xl bg-core-primary-container px-5 py-2.5 text-sm font-semibold text-core-on-primary shadow-sm transition hover:bg-core-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name={saving ? "autorenew" : "check"} className={`!text-[18px] ${saving ? "animate-spin" : ""}`} />
                {saving ? "Saving..." : "Save Preferences"}
              </button>
            </div>
          </div>

          {loadError ? (
            <div className="mb-5 rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
              {loadError}
            </div>
          ) : null}
          {saveError ? (
            <div className="mb-5 rounded-xl border border-core-error/30 bg-state-danger-soft px-4 py-3 text-sm text-core-error">
              {saveError}
            </div>
          ) : null}

          <nav
            aria-label="Settings sections"
            className="mb-6 flex gap-1.5 overflow-x-auto rounded-xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-1.5"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? "page" : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? "bg-core-primary-fixed text-core-primary"
                    : "text-core-on-surface-variant hover:bg-core-surface-container-high hover:text-core-on-surface"
                }`}
              >
                <Icon name={tab.icon} className="!text-[18px]" />
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              {(!draft || !settings) && activeTab !== "feedback" ? (
                <div className="space-y-5">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-64 animate-pulse rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest"
                    />
                  ))}
                </div>
              ) : null}

              {draft && settings && activeTab === "profile" ? (
                <>
                  <SectionCard
                    icon="person"
                    title="User Profile & Identity"
                    description="Control your personal bio, team attribution, and localized timestamps."
                    badge={
                      <span className="font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                        ID: {settings.user_id.slice(0, 8).toUpperCase()}
                      </span>
                    }
                  >
                    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4">
                      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-core-primary text-xl font-bold text-core-on-primary">
                        {settings.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={settings.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          initials
                        )}
                        {settings.email_verified ? (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-core-surface-container-low bg-core-primary text-core-on-primary">
                            <Icon name="check" className="!text-[12px]" />
                          </span>
                        ) : null}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg border border-core-outline-variant/30 bg-core-surface px-3 py-1.5 text-sm font-semibold text-core-on-surface">
                            {settings.full_name || settings.email.split("@")[0]}
                          </span>
                          <span className="font-jetbrains-mono text-[11px] uppercase text-core-on-surface-variant">
                            {settings.timezone.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-core-on-surface-variant">
                          Profile photos follow your workspace avatar. JPG, WebP or PNG. Max size 2.5MB.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Full Name">
                        <input
                          value={draft.full_name}
                          onChange={(event) => patch({ full_name: event.target.value })}
                          placeholder="Your name"
                          className={inputClass}
                        />
                      </Field>

                      <Field
                        label="Work Email"
                        hint={
                          settings.email_verified ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-core-primary">
                              <Icon name="check_circle" className="!text-[14px]" />
                              Verified
                            </span>
                          ) : null
                        }
                      >
                        <input
                          value={settings.email}
                          readOnly
                          aria-readonly="true"
                          title="Your sign-in email cannot be changed here."
                          className={`${inputClass} cursor-not-allowed text-core-on-surface-variant`}
                        />
                      </Field>

                      <Field label="Role / Organizational Title">
                        <input
                          value={draft.role_title}
                          onChange={(event) => patch({ role_title: event.target.value })}
                          placeholder="e.g. VP Product Strategy"
                          className={inputClass}
                        />
                      </Field>

                      <Field label="Timezone">
                        <Select
                          label="Timezone"
                          value={draft.timezone}
                          onChange={(value) => patch({ timezone: value })}
                          options={settings.timezone_options}
                        />
                      </Field>
                    </div>

                    <div className="mt-5 rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-core-on-surface">Password</p>
                          <p className="text-xs text-core-on-surface-variant">
                            {passwordChanged ? `Last changed ${passwordChanged}` : "Keep your account secure."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowPasswordForm((open) => !open)}
                          className="rounded-lg border border-core-outline-variant/30 bg-core-surface px-3.5 py-2 text-sm font-semibold text-core-on-surface transition hover:bg-core-surface-container-high"
                        >
                          {showPasswordForm ? "Cancel" : "Change password"}
                        </button>
                      </div>

                      {passwordState ? (
                        <p
                          className={`mt-3 text-sm ${
                            passwordState.tone === "ok" ? "text-state-on-success-soft" : "text-core-error"
                          }`}
                        >
                          {passwordState.text}
                        </p>
                      ) : null}

                      {showPasswordForm ? (
                        <form onSubmit={onChangePassword} className="mt-4 animate-fade-in grid gap-3 sm:grid-cols-2">
                          <Field label="Current password">
                            <input
                              type="password"
                              autoComplete="current-password"
                              value={currentPassword}
                              onChange={(event) => setCurrentPassword(event.target.value)}
                              required
                              className={inputClass}
                            />
                          </Field>
                          <Field label="New password">
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={newPassword}
                              onChange={(event) => setNewPassword(event.target.value)}
                              required
                              minLength={8}
                              className={inputClass}
                            />
                          </Field>
                          <div className="sm:col-span-2">
                            <button
                              type="submit"
                              disabled={changingPassword}
                              className="rounded-xl bg-core-primary px-4 py-2.5 text-sm font-semibold text-core-on-primary transition hover:bg-core-surface-tint disabled:opacity-60"
                            >
                              {changingPassword ? "Updating..." : "Update password"}
                            </button>
                            <p className="mt-2 text-xs text-core-on-surface-variant">
                              Use at least 8 characters.
                            </p>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </SectionCard>

                  <SectionCard
                    icon="warning"
                    title="Danger Zone"
                    description="Irreversible actions concerning your account session and data."
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4">
                        <div>
                          <p className="text-sm font-semibold text-core-on-surface">Log out</p>
                          <p className="text-xs text-core-on-surface-variant">
                            End your active session on this device.
                          </p>
                        </div>
                        <Link
                          href="/logout"
                          className="rounded-lg border border-core-outline-variant/30 bg-core-surface px-3.5 py-2 text-sm font-semibold text-core-on-surface transition hover:bg-core-surface-container-high"
                        >
                          Log out
                        </Link>
                      </div>

                      <div className="rounded-lg border border-core-error/25 bg-state-danger-soft/60 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-core-error">Delete account</p>
                            <p className="text-xs text-core-on-surface-variant">
                              Permanently remove your personal notes, transcriptions, and account data.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setShowDeleteForm((open) => !open);
                              setDeleteError(null);
                            }}
                            className="rounded-lg border border-core-error/40 bg-core-surface px-3.5 py-2 text-sm font-semibold text-core-error transition hover:bg-state-danger-soft"
                          >
                            {showDeleteForm ? "Cancel" : "Delete account"}
                          </button>
                        </div>

                        {showDeleteForm ? (
                          <div className="mt-4 animate-fade-in space-y-3">
                            <Field label={`Type ${settings.email} to confirm`}>
                              <input
                                value={deleteConfirm}
                                onChange={(event) => setDeleteConfirm(event.target.value)}
                                placeholder={settings.email}
                                className={inputClass}
                              />
                            </Field>
                            {deleteError ? <p className="text-sm text-core-error">{deleteError}</p> : null}
                            <button
                              type="button"
                              disabled={deleting || deleteConfirm.trim().toLowerCase() !== settings.email}
                              onClick={() => void onDeleteAccount()}
                              className="rounded-xl bg-core-error px-4 py-2.5 text-sm font-semibold text-core-surface transition hover:bg-core-error/85 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deleting ? "Deleting..." : "Permanently delete my account"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </SectionCard>
                </>
              ) : null}

              {draft && settings && activeTab === "billing" ? (
                <SectionCard
                  icon="credit_card"
                  title="Plan & Billing"
                  description="Manage your subscription plan and payment details."
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4">
                    <div>
                      <p className="font-display text-lg font-bold text-core-on-surface">
                        {usage?.plan_label ?? "Free Starter"}
                        {usage?.plan_price_monthly != null ? (
                          <span className="ml-2 font-jetbrains-mono text-sm font-semibold text-core-primary">
                            ${usage.plan_price_monthly} / mo
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-core-on-surface-variant">
                        {usage?.renews_on
                          ? `Quota resets on ${new Date(usage.renews_on).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}`
                          : "Usage-based quotas reset monthly."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/upgrade"
                        className="rounded-lg border border-core-outline-variant/30 bg-core-surface px-3.5 py-2 text-sm font-semibold text-core-on-surface transition hover:bg-core-surface-container-high"
                      >
                        Manage subscription
                      </Link>
                      {usage?.tier === "free" ? (
                        <button
                          type="button"
                          onClick={onUpgrade}
                          disabled={upgrading}
                          className="rounded-lg bg-core-primary px-3.5 py-2 text-sm font-semibold text-core-on-primary transition hover:bg-core-surface-tint disabled:opacity-60"
                        >
                          {upgrading ? "Opening..." : "Upgrade plan"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Videos this period", value: usage ? String(usage.videos_processed) : "--" },
                      { label: "Insights extracted", value: usage ? String(usage.insights_extracted) : "--" },
                      {
                        label: "Subscription status",
                        value: usage ? usage.subscription_status : "--",
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-core-outline-variant/20 bg-core-surface-container-low p-4"
                      >
                        <dt className="font-jetbrains-mono text-[10px] font-semibold uppercase tracking-wider text-core-on-surface-variant">
                          {stat.label}
                        </dt>
                        <dd className="mt-1 font-display text-xl font-bold capitalize text-core-on-surface">
                          {stat.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </SectionCard>
              ) : null}

              {activeTab === "feedback" ? <FeedbackPanel /> : null}
            </div>

            <TierRail usage={usage} onUpgrade={onUpgrade} upgrading={upgrading} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-core-background">
            <span
              className="h-8 w-8 animate-spin rounded-full border-2 border-core-primary border-t-transparent"
              aria-hidden="true"
            />
          </div>
        }
      >
        <SettingsPageContent />
      </Suspense>
    </AuthGuard>
  );
}

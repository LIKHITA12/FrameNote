"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

import { exchangeSsoCode, login } from "@/lib/api";
import { isAuthenticated, startSession } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { SsoProvider, startSso } from "@/lib/sso";
import { SsoButtons } from "@/components/SsoButtons";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { StatusBanner } from "@/components/ui/StatusBanner";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURE_BADGES = [
  { label: "AI Video Intelligence 2.0", icon: <path d="M12 2v4m0 12v4M2 12h4m12 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8" /> },
  { label: "Instant Timestamps & Chapters", icon: <path d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" /> },
  { label: "High-Accuracy Transcription", icon: <path d="m9 12 2 2 4-4m5 2a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" /> },
];

function BadgeIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      {children}
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-brand-light/70">
      <path d="M7.17 6A5.17 5.17 0 0 0 2 11.17V18h6.83v-6.83H4.5c0-1.47 1.2-2.67 2.67-2.67V6Zm10 0A5.17 5.17 0 0 0 12 11.17V18h6.83v-6.83H14.5c0-1.47 1.2-2.67 2.67-2.67V6Z" />
    </svg>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [activeSsoProvider, setActiveSsoProvider] = useState<SsoProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completingSso, setCompletingSso] = useState(false);

  useEffect(() => {
    const ssoCode = searchParams.get("sso_code");
    const ssoFailure = searchParams.get("sso_error");

    if (ssoCode) {
      setCompletingSso(true);
      router.replace("/login");
      void exchangeSsoCode(ssoCode)
        .then(({ accessToken, user }) => {
          startSession(accessToken, user.email, true, user.full_name ?? undefined);
          router.push("/");
        })
        .catch((error) => {
          setSsoError(error instanceof Error ? error.message : "Sign-in did not complete. Please try again.");
          setCompletingSso(false);
        });
      return;
    }

    if (ssoFailure) {
      setSsoError(ssoFailure);
      router.replace("/login");
      return;
    }

    if (isAuthenticated()) {
      router.replace("/");
    }
  }, []);

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    } else if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSsoError(null);

    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const { accessToken, user } = await login(email, password);
      startSession(accessToken, user.email, remember, user.full_name ?? undefined);
      router.push("/");
    } catch {
      setFormError("We couldn't sign you in. Check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onSsoClick(provider: SsoProvider) {
    setFormError(null);
    setSsoError(null);
    setActiveSsoProvider(provider);
    const result = startSso(provider);
    if (!result.ok) {
      setSsoError(result.message);
      setActiveSsoProvider(null);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-8 [font-family:Avenir_Next,Segoe_UI,Helvetica_Neue,sans-serif] sm:px-6 lg:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-brand-dark/10 blur-3xl"
      />

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-[1.5rem] bg-surface shadow-[0_32px_80px_-32px_rgba(15,23,42,0.35)] lg:grid-cols-12">
        <section className="relative hidden min-h-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand via-brand-dark to-brand-ink p-10 text-white lg:col-span-5 lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-brand-light/20 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-white/10 blur-2xl" />

          <div className="relative z-10 flex flex-col gap-8">
            <Logo size={30} onDark />

            <div className="mt-2 flex flex-col gap-4">
              <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">
                Turn hours of video into{" "}
                <span className="underline decoration-brand-light/50 decoration-4 underline-offset-4">
                  minutes of notes.
                </span>
              </h1>
              <p className="text-sm leading-relaxed text-white/90">
                Convert long recordings, meetings, and video lectures into crisp executive summaries, instant
                chapters, and actionable insights.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              {FEATURE_BADGES.map((badge) => (
                <div
                  key={badge.label}
                  className="flex w-fit items-center gap-2.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium backdrop-blur-sm"
                >
                  <span className="text-brand-light">
                    <BadgeIcon>{badge.icon}</BadgeIcon>
                  </span>
                  {badge.label}
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 mt-6 rounded-xl bg-white/10 p-4 backdrop-blur-md">
            <QuoteIcon />
            <p className="mt-1.5 text-sm italic leading-snug text-white">
              &ldquo;A 90-minute recording, distilled into a 2-minute read &mdash; searchable chapters and all.&rdquo;
            </p>
            <p className="mt-2 text-xs text-brand-light">How teams use FrameNote every day</p>
          </div>
        </section>

        <section className="flex min-h-[640px] items-center justify-center px-5 py-10 sm:px-10 lg:col-span-7">
          {completingSso ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden="true" />
              <p className="text-sm text-muted">Finishing sign-in…</p>
            </div>
          ) : (
          <div className="w-full max-w-md">
            <div className="mb-6 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                <span className="text-xs font-bold uppercase tracking-widest text-brand">Welcome Back</span>
              </div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-brand-ink">Sign in to FrameNote</h2>
              <p className="text-sm text-muted">Enter your email and password to continue.</p>
            </div>

            {formError ? (
              <div className="mb-4">
                <StatusBanner tone="error">{formError}</StatusBanner>
              </div>
            ) : null}
            {ssoError ? (
              <div className="mb-4">
                <StatusBanner tone="warning">{ssoError}</StatusBanner>
              </div>
            ) : null}

            <SsoButtons activeProvider={activeSsoProvider} disabled={submitting} onProviderClick={onSsoClick} />

            <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-2">
              <FormField
                label="Work Email"
                type="email"
                autoComplete="email"
                placeholder="alex@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={fieldErrors.email}
                disabled={submitting}
                className="focus:!border-brand focus:!ring-brand/30"
                required
              />

              <FormField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={fieldErrors.password}
                disabled={submitting}
                className="focus:!border-brand focus:!ring-brand/30"
                required
              />

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-ink">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                  Keep me signed in for 30 days
                </label>
                <Link href="/forgot-password" className="font-semibold text-brand underline-offset-4 hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" variant="brand" loading={submitting} fullWidth className="mt-1 rounded-lg">
                {submitting ? "Signing in…" : "Sign in to workspace"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-brand underline-offset-4 hover:underline">
                Create account
              </Link>
            </p>
          </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams() (the SSO callback params) needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

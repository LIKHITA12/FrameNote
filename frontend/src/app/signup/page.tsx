"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { signup } from "@/lib/api";
import { isAuthenticated, startSession } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { SsoProvider, startSso } from "@/lib/sso";
import { SsoButtons } from "@/components/SsoButtons";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { StatusBanner } from "@/components/ui/StatusBanner";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PERKS = [
  "Free account with no credit card required",
  "1 short upload and 3 YouTube caption notes each month",
  "AI summary, key moments, and timestamps",
  "PDF export included",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.5 5.6A10.4 10.4 0 0 1 12 5.3c5 0 9 4 10 6.7a11.5 11.5 0 0 1-3.2 4.2M6.2 6.9C4 8.6 2.4 10.9 2 12c.8 2.3 3.7 5.7 8 6.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M2 12c1-2.7 5-6.7 10-6.7s9 4 10 6.7c-1 2.7-5 6.7-10 6.7s-9-4-10-6.7Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[0-9]/.test(password)) score += 1;
  if (password.length >= 12 && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score as 0 | 1 | 2 | 3;
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    agree?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [activeSsoProvider, setActiveSsoProvider] = useState<SsoProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/");
    }
  }, [router]);

  function validate(): boolean {
    const errors: typeof fieldErrors = {};

    if (!fullName.trim()) {
      errors.fullName = "Full name is required.";
    }

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

    if (!confirmPassword) {
      errors.confirmPassword = "Confirm your password.";
    } else if (confirmPassword !== password) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (!agree) {
      errors.agree = "Please accept the terms to continue.";
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
      const { accessToken, user } = await signup(email, password, fullName);
      startSession(accessToken, user.email, true, user.full_name ?? undefined);
      router.push("/");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "We could not create your account right now. Please try again.");
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
        <section className="relative hidden min-h-[720px] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand via-brand-dark to-brand-ink p-10 text-white lg:col-span-5 lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-brand-light/20 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-white/10 blur-2xl" />

          <div className="relative z-10 flex flex-col gap-6">
            <Logo size={30} onDark />

            <div className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-light" />
              <span className="text-[11px] font-bold uppercase tracking-widest">Pro Workspace 3.0</span>
            </div>

            <div className="flex flex-col gap-4">
              <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">
                Start turning video into actionable knowledge.
              </h1>
              <p className="text-sm leading-relaxed text-white/90">
                Join researchers, engineers, and creators who summarize, synthesize, and index visual content in
                seconds.
              </p>
            </div>

            <ul className="flex flex-col gap-2.5 pt-2 text-sm">
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-brand-light">
                    <CheckIcon />
                  </span>
                  <span className="text-white/90">{perk}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative z-10 mt-6 rounded-xl bg-white/10 p-4 backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-light">
                AI Key Takeaway
              </span>
              <span className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[11px]">12:44</span>
            </div>
            <p className="text-sm font-semibold leading-snug text-white">
              &ldquo;Q3 Product Roadmap: Vector Indexing Speedup&rdquo;
            </p>
            <p className="mt-1.5 text-xs text-white/70">Synthesized 9 critical milestones • 3 tasks assigned</p>
          </div>
        </section>

        <section className="flex min-h-[720px] items-center justify-center px-5 py-10 sm:px-10 lg:col-span-7">
          <div className="w-full max-w-md">
            <div className="mb-6 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                <span className="text-xs font-bold uppercase tracking-widest text-brand">Get Started Free</span>
              </div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-brand-ink">Create your account</h2>
              <p className="text-sm text-muted">Start on the Free plan. No credit card required.</p>
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
                label="Full Name"
                type="text"
                autoComplete="name"
                placeholder="Alex Rivera"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                error={fieldErrors.fullName}
                disabled={submitting}
                className="focus:!border-brand focus:!ring-brand/30"
                required
              />

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

              <div className="flex flex-col gap-1">
                <div className="relative">
                  <FormField
                    label="Create Password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    error={fieldErrors.password}
                    disabled={submitting}
                    className="pr-10 focus:!border-brand focus:!ring-brand/30"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-[34px] text-muted hover:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    <EyeIcon hidden={showPassword} />
                  </button>
                </div>
                {password ? (
                  <div className="mb-1 flex gap-1.5" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <span
                        key={index}
                        className={`h-1 flex-1 rounded-full ${
                          index < strength
                            ? strength === 1
                              ? "bg-danger"
                              : strength === 2
                                ? "bg-warning"
                                : "bg-state-success"
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <FormField
                label="Confirm password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                error={fieldErrors.confirmPassword}
                disabled={submitting}
                className="focus:!border-brand focus:!ring-brand/30"
                required
              />

              <div>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={agree}
                    onChange={(event) => setAgree(event.target.checked)}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                  I agree to the terms and privacy policy.
                </label>
                <p className="min-h-[1rem] text-xs font-medium text-danger">{fieldErrors.agree || " "}</p>
              </div>

              <Button type="submit" variant="brand" loading={submitting} fullWidth className="mt-1 rounded-lg">
                {submitting ? "Creating account…" : "Create Free Account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-brand underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

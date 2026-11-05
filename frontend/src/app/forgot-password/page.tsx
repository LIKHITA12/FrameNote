"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { requestPasswordReset } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/ui/FormField";
import { StatusBanner } from "@/components/ui/StatusBanner";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-fade-in-up">
        <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
        <p className="mt-2 text-sm text-muted">
          Enter your account email and we&apos;ll send you a link to reset your password.
        </p>

        {done ? (
          <div className="mt-4">
            <StatusBanner tone="success">
              If that email is registered, a reset link has been sent.
            </StatusBanner>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-3">
            {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
            <FormField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="font-semibold text-brand underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}

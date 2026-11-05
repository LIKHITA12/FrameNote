"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { clearSession, isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBanner } from "@/components/ui/StatusBanner";

type Step = "confirm" | "signing-out" | "done" | "error";

export default function LogoutPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(isAuthenticated() ? "confirm" : "done");

  async function handleConfirm() {
    setStep("signing-out");
    try {
      // JWTs are stateless, so signing out just discards the locally stored token.
      clearSession();
      setStep("done");
      router.push("/login");
    } catch {
      setStep("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-fade-in-up text-center">
        {step === "confirm" ? (
          <>
            <h1 className="text-xl font-semibold text-ink">Log out of FrameNote?</h1>
            <p className="mt-2 text-sm text-muted">
              You will need to sign in again to create new jobs or view your history.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void handleConfirm()}>
                Log out
              </Button>
            </div>
          </>
        ) : null}

        {step === "signing-out" ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-4">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />
            <p className="text-sm text-muted">Signing you out…</p>
          </div>
        ) : null}

        {step === "error" ? (
          <>
            <StatusBanner tone="error">Something went wrong while signing out.</StatusBanner>
            <div className="mt-4">
              <Button onClick={() => void handleConfirm()}>Try again</Button>
            </div>
          </>
        ) : null}

        {step === "done" ? (
          <>
            <StatusBanner tone="success">You have been signed out.</StatusBanner>
            <div className="mt-4">
              <Button onClick={() => router.push("/login")}>Back to sign in</Button>
            </div>
          </>
        ) : null}
      </Card>
    </main>
  );
}

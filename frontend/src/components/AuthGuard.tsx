"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { isAuthenticated } from "@/lib/auth";

/**
 * Client-side route guard. Redirects to /login when no active session
 * exists. Renders nothing until the check completes to avoid a flash of
 * protected content.
 */
export function AuthGuard({
  children,
  redirectTo = "/login",
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace(redirectTo);
      return;
    }
    setChecked(true);
  }, [router, redirectTo]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-core-background" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-core-primary border-t-transparent" aria-hidden="true" />
        <span className="sr-only">Checking session…</span>
      </div>
    );
  }

  return <>{children}</>;
}

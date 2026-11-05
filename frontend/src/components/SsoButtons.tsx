import { useEffect, useState } from "react";

import { fetchConfiguredSsoProviders, SsoProvider } from "@/lib/sso";

type Props = {
  activeProvider: SsoProvider | null;
  disabled?: boolean;
  onProviderClick: (provider: SsoProvider) => void;
};

const PROVIDERS: Array<{ id: SsoProvider; label: string }> = [
  { id: "google", label: "Continue with Google" },
  { id: "facebook", label: "Continue with Facebook" },
  { id: "microsoft", label: "Continue with Microsoft" },
];

export function SsoButtons({ activeProvider, disabled = false, onProviderClick }: Props) {
  const [configured, setConfigured] = useState<SsoProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchConfiguredSsoProviders().then((providers) => {
      if (!cancelled) setConfigured(providers);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = PROVIDERS.filter((provider) => configured.includes(provider.id));
  if (providers.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted">or continue with</p>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      <div className={`mt-3 grid gap-3 ${providers.length === 1 ? "grid-cols-1" : providers.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {providers.map((provider) => {
          const isActive = activeProvider === provider.id;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onProviderClick(provider.id)}
              disabled={disabled || Boolean(activeProvider)}
              aria-label={provider.label}
              className="group flex h-12 items-center justify-center rounded-xl border border-border bg-surface transition hover:border-brand hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
              title={provider.label}
            >
              {isActive ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent"
                  aria-hidden="true"
                />
              ) : provider.id === "google" ? (
                <GoogleIcon />
              ) : provider.id === "facebook" ? (
                <FacebookIcon />
              ) : (
                <MicrosoftIcon />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v4.2h5.9c-.3 1.3-1.9 3.8-5.9 3.8-3.6 0-6.5-3-6.5-6.7s2.9-6.7 6.5-6.7c2.1 0 3.5.9 4.3 1.6l2.9-2.8C17.4 1.9 14.9 1 12 1 5.9 1 1 5.9 1 12s4.9 11 11 11c6.3 0 10.4-4.4 10.4-10.6 0-.7-.1-1.2-.2-1.7H12z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" fill="#F25022" />
      <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
      <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

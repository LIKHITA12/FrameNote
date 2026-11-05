export type SsoProvider = "google" | "facebook" | "microsoft";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

/** Asks the backend which providers actually have credentials configured, so we only show
 * buttons that will work. Single source of truth lives in the backend's env vars. */
export async function fetchConfiguredSsoProviders(): Promise<SsoProvider[]> {
  if (!apiBaseUrl) return [];
  try {
    const response = await fetch(`${apiBaseUrl}/auth/sso/providers`);
    if (!response.ok) return [];
    const data: Partial<Record<SsoProvider, boolean>> = await response.json();
    return (Object.keys(data) as SsoProvider[]).filter((provider) => data[provider]);
  } catch {
    return [];
  }
}

export function startSso(provider: SsoProvider): { ok: true } | { ok: false; message: string } {
  if (typeof window === "undefined" || !apiBaseUrl) {
    return { ok: false, message: "SSO is only available in the browser." };
  }
  window.location.assign(`${apiBaseUrl}/auth/${provider}/login`);
  return { ok: true };
}

// Lightweight client-side session helpers.
//
// Session is now backed by a real JWT issued by POST /auth/login or
// /auth/signup (see lib/api.ts) instead of a trusted, unverified email header.

const TOKEN_STORAGE_KEY = "framenote:access-token";
const SESSION_STORAGE_KEY = "framenote:user-email";
const NAME_STORAGE_KEY = "framenote:user-name";
const REMEMBER_FLAG_KEY = "framenote:remember";

export interface Session {
  email: string;
  fullName?: string;
  token: string;
}

function getStorage(remember: boolean): Storage {
  return remember ? window.localStorage : window.sessionStorage;
}

export function getActiveSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.localStorage.getItem(TOKEN_STORAGE_KEY) || window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const email = window.localStorage.getItem(SESSION_STORAGE_KEY) || window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!token || !email || !email.includes("@")) {
    return null;
  }
  const fullName = window.localStorage.getItem(NAME_STORAGE_KEY) || window.sessionStorage.getItem(NAME_STORAGE_KEY);
  return { email, fullName: fullName || undefined, token };
}

export function isAuthenticated(): boolean {
  return getActiveSession() !== null;
}

export function startSession(token: string, email: string, remember: boolean, fullName?: string): void {
  const normalized = email.trim().toLowerCase();
  clearSession();
  const storage = getStorage(remember);
  storage.setItem(TOKEN_STORAGE_KEY, token);
  storage.setItem(SESSION_STORAGE_KEY, normalized);
  if (fullName && fullName.trim()) {
    storage.setItem(NAME_STORAGE_KEY, fullName.trim());
  }
  window.localStorage.setItem(REMEMBER_FLAG_KEY, remember ? "true" : "false");
}

export function clearSession(): void {
  for (const key of [TOKEN_STORAGE_KEY, SESSION_STORAGE_KEY, NAME_STORAGE_KEY, REMEMBER_FLAG_KEY]) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
}

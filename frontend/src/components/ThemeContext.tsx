"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "framenote:theme";

export type Theme = "light" | "dark";

/** Runs before first paint (see layout.tsx) so dark-mode users never see a flash of light theme.
 *  Kept in sync with STORAGE_KEY above by hand — it cannot import anything. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("framenote:theme");if(t==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})();`;

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Must match the server-rendered default; the init script may already have added .dark,
  // which the effect below reconciles on mount.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      apply(stored);
    }
  }, []);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      apply(next);
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

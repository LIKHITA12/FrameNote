import type { Config } from "tailwindcss";

/** Token values live as RGB channels in globals.css (:root and .dark), so a single class on
 *  <html> reskins everything. The <alpha-value> placeholder preserves `bg-core-primary/40`. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        ink: token("ink"),
        muted: token("muted"),
        border: token("border"),
        accent: token("accent"),
        "accent-dark": token("accent-dark"),
        "accent-soft": token("accent-soft"),
        danger: token("danger"),
        "danger-soft": token("danger-soft"),
        warning: token("warning"),
        "warning-soft": token("warning-soft"),
        // FrameNote wordmark brand palette (logo + marketing/processing surfaces).
        brand: {
          light: token("brand-light"),
          DEFAULT: token("brand"),
          dark: token("brand-dark"),
          ink: token("brand-ink"),
          soft: token("brand-soft"),
        },
        // Semantic status pairs. Use these instead of raw emerald/amber/rose literals so
        // success and error states stay legible in both themes.
        state: {
          success: token("state-success"),
          "success-soft": token("state-success-soft"),
          "on-success-soft": token("state-on-success-soft"),
          warning: token("state-warning"),
          "warning-soft": token("state-warning-soft"),
          "on-warning-soft": token("state-on-warning-soft"),
          danger: token("state-danger"),
          "danger-soft": token("state-danger-soft"),
          "on-danger-soft": token("state-on-danger-soft"),
        },
        // "FrameNote Core" design-system tokens used across the authenticated workspace.
        core: {
          primary: token("core-primary"),
          "on-primary": token("core-on-primary"),
          "primary-container": token("core-primary-container"),
          "on-primary-container": token("core-on-primary-container"),
          "primary-fixed": token("core-primary-fixed"),
          "on-primary-fixed": token("core-on-primary-fixed"),
          "surface-tint": token("core-surface-tint"),
          secondary: token("core-secondary"),
          "on-secondary": token("core-on-secondary"),
          "secondary-container": token("core-secondary-container"),
          "on-secondary-container": token("core-on-secondary-container"),
          tertiary: token("core-tertiary"),
          "on-tertiary": token("core-on-tertiary"),
          "tertiary-container": token("core-tertiary-container"),
          "on-tertiary-container": token("core-on-tertiary-container"),
          error: token("core-error"),
          background: token("core-background"),
          "on-background": token("core-on-background"),
          surface: token("core-surface"),
          "surface-dim": token("core-surface-dim"),
          "surface-bright": token("core-surface-bright"),
          "surface-container-lowest": token("core-surface-container-lowest"),
          "surface-container-low": token("core-surface-container-low"),
          "surface-container": token("core-surface-container"),
          "surface-container-high": token("core-surface-container-high"),
          "surface-container-highest": token("core-surface-container-highest"),
          "on-surface": token("core-on-surface"),
          "on-surface-variant": token("core-on-surface-variant"),
          outline: token("core-outline"),
          "outline-variant": token("core-outline-variant"),
          "inverse-surface": token("core-inverse-surface"),
          "inverse-on-surface": token("core-inverse-on-surface"),
        },
      },
      fontFamily: {
        display: ["var(--font-manrope)", "Manrope", "sans-serif"],
        script: ["var(--font-caveat)", "cursive"],
        // "FrameNote Core" type system used on the /welcome page redesign.
        body: ["var(--font-inter)", "Inter", "sans-serif"],
        "jetbrains-mono": ["var(--font-jetbrains-mono)", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px -12px rgba(17, 24, 39, 0.12)",
        "card-hover": "0 2px 4px rgba(17, 24, 39, 0.06), 0 16px 32px -12px rgba(17, 24, 39, 0.16)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "42%": { transform: "translate3d(0, 16px, 0)" },
          "56%": { transform: "translate3d(0, 10px, 0)" },
        },
        "float-reverse": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "42%": { transform: "translate3d(14px, -14px, 0)" },
          "56%": { transform: "translate3d(8px, -8px, 0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", boxShadow: "0 0 0 0 rgba(79,70,229,0.5)" },
          "70%": { transform: "scale(1.05)", boxShadow: "0 0 0 16px rgba(79,70,229,0)" },
          "100%": { transform: "scale(0.95)", boxShadow: "0 0 0 0 rgba(79,70,229,0)" },
        },
        "progress-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "shimmer-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "subtle-float": {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "50%": { transform: "translateY(-8px) rotate(0.5deg)" },
        },
        scanline: {
          "0%": { top: "0%", opacity: "0" },
          "20%": { opacity: "0.8" },
          "80%": { opacity: "0.8" },
          "100%": { top: "100%", opacity: "0" },
        },
        "aura-pulse": {
          "0%, 100%": { opacity: "0.35", transform: "scale(1)" },
          "50%": { opacity: "0.65", transform: "scale(1.02)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out both",
        "fade-in": "fade-in 0.3s ease-out both",
        float: "float 8s ease-in-out infinite",
        "float-reverse": "float-reverse 10s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "progress-glow": "progress-shimmer 2.5s linear infinite",
        "shimmer-sweep": "shimmer-sweep 2s infinite",
        "float-smooth": "subtle-float 4.5s ease-in-out infinite",
        scanline: "scanline 3.2s cubic-bezier(0.4,0,0.2,1) infinite",
        aura: "aura-pulse 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

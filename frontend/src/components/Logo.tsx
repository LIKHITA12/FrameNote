type Props = {
  className?: string;
  /** Icon square size in pixels. Wordmark scales proportionally. */
  size?: number;
  showWordmark?: boolean;
  /** Use light wordmark text + a white icon chip for placement on dark/brand backgrounds. */
  onDark?: boolean;
};

/**
 * FrameNote wordmark: folded-note/play-triangle icon in deep royal blue,
 * paired with the "Frame" + cursive "note" lockup. No green, per brand update.
 */
export function Logo({ className = "", size = 32, showWordmark = true, onDark = false }: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className={onDark ? "flex items-center justify-center rounded-xl bg-white p-1.5 shadow-sm" : ""}
        style={onDark ? { width: size + 12, height: size + 12 } : undefined}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="FrameNote"
          className="shrink-0"
        >
          <defs>
            <linearGradient id="fn-logo-gradient" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#3B82F6" />
              <stop offset="1" stopColor="#1E3A8A" />
            </linearGradient>
          </defs>
          <path
            d="M14 4h13.17a4 4 0 0 1 2.83 1.17l10.83 10.83A4 4 0 0 1 42 18.83V40a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"
            fill="url(#fn-logo-gradient)"
          />
          <path d="M27 4v9a4 4 0 0 0 4 4h9L27 4Z" fill="#BFDBFE" />
          <path d="M21 16.5 32 24l-11 7.5v-15Z" fill="#ffffff" />
        </svg>
      </span>
      {showWordmark ? (
        <span
          className={`flex items-baseline leading-none ${onDark ? "text-white" : "text-brand-ink"}`}
          style={{ fontSize: size * 0.62 }}
        >
          <span className="font-display font-extrabold tracking-tight">Frame</span>
          <span className={`-ml-0.5 font-script text-[1.35em] leading-none ${onDark ? "text-brand-light" : ""}`}>
            note
          </span>
        </span>
      ) : null}
    </span>
  );
}

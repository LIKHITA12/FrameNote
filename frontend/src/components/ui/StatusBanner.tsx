interface StatusBannerProps {
  tone: "error" | "success" | "warning" | "info";
  children: React.ReactNode;
}

const toneClasses: Record<StatusBannerProps["tone"], string> = {
  error: "bg-danger-soft text-danger border-danger/20",
  success: "bg-accent-soft text-accent-dark border-accent/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  info: "bg-canvas text-ink border-border",
};

export function StatusBanner({ tone, children }: StatusBannerProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`animate-fade-in rounded-xl border px-4 py-3 text-sm font-medium ${toneClasses[tone]}`}
    >
      {children}
    </div>
  );
}

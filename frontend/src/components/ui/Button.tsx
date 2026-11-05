import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brand";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  // text-canvas rather than text-white: in dark mode these fills become light, so the label
  // has to darken with them to stay readable.
  primary:
    "bg-accent text-canvas hover:bg-accent-dark focus-visible:ring-accent disabled:hover:bg-accent",
  secondary:
    "bg-surface text-ink border border-border hover:bg-canvas focus-visible:ring-accent",
  ghost: "bg-transparent text-ink hover:bg-canvas focus-visible:ring-accent",
  danger: "bg-danger text-canvas hover:bg-danger/80 focus-visible:ring-danger",
  brand: "bg-brand text-canvas hover:bg-brand-dark focus-visible:ring-brand disabled:hover:bg-brand",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth = false, disabled, className = "", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
});

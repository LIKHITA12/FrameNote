import { InputHTMLAttributes, forwardRef, useId } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { label, error, hint, id, className = "", ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`w-full rounded-xl border px-3.5 py-2.5 text-sm text-ink shadow-sm outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30 ${
          error ? "border-danger" : "border-border"
        } ${className}`}
        {...rest}
      />
      <p
        id={error ? errorId : hint ? hintId : undefined}
        role={error ? "alert" : undefined}
        className={`min-h-[0.875rem] text-[11px] leading-[0.875rem] ${error ? "font-medium text-danger" : "text-muted"}`}
      >
        {error || hint || " "}
      </p>
    </div>
  );
});

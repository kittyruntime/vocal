import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  visuallyHiddenLabel,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  visuallyHiddenLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor} className={visuallyHiddenLabel ? "sr-only" : undefined}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-message`} className="form-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-message`} className="form-hint">{hint}</p>
      ) : null}
    </div>
  );
}

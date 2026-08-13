import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { FormField } from "./FormField";

export const TextField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    error?: string;
    hint?: string;
    visuallyHiddenLabel?: boolean;
    prefix?: ReactNode;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "id">
>(function TextField({ label, error, hint, visuallyHiddenLabel, prefix, className, ...inputProps }, ref) {
  const id = useId();
  const input = (
    <input
      ref={ref}
      id={id}
      className={["form-input", className].filter(Boolean).join(" ")}
      aria-describedby={error || hint ? `${id}-message` : undefined}
      aria-invalid={error ? true : undefined}
      {...inputProps}
    />
  );
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint} visuallyHiddenLabel={visuallyHiddenLabel}>
      {prefix ? (
        <div className="form-input-group">
          <span aria-hidden="true" className="form-input-prefix">{prefix}</span>
          {input}
        </div>
      ) : input}
    </FormField>
  );
});

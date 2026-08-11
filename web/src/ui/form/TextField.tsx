import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { FormField } from "./FormField";

export function TextField({
  label,
  error,
  hint,
  visuallyHiddenLabel,
  prefix,
  className,
  ...inputProps
}: {
  label: string;
  error?: string;
  hint?: string;
  visuallyHiddenLabel?: boolean;
  prefix?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  const id = useId();
  const input = (
    <input id={id} className={["form-input", className].filter(Boolean).join(" ")} {...inputProps} />
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
}

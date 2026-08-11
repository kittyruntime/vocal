import { useId, type InputHTMLAttributes } from "react";
import { FormField } from "./FormField";

export function TextField({
  label,
  error,
  hint,
  visuallyHiddenLabel,
  className,
  ...inputProps
}: {
  label: string;
  error?: string;
  hint?: string;
  visuallyHiddenLabel?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint} visuallyHiddenLabel={visuallyHiddenLabel}>
      <input id={id} className={["form-input", className].filter(Boolean).join(" ")} {...inputProps} />
    </FormField>
  );
}

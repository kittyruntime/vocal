import { useId, type TextareaHTMLAttributes } from "react";
import { FormField } from "./FormField";

export function Textarea({
  label,
  error,
  hint,
  className,
  ...textareaProps
}: {
  label: string;
  error?: string;
  hint?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint}>
      <textarea
        id={id}
        className={["form-input", className].filter(Boolean).join(" ")}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        aria-invalid={error ? true : undefined}
        {...textareaProps}
      />
    </FormField>
  );
}

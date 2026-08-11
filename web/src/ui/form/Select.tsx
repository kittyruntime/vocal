import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { FormField } from "./FormField";

export function Select({
  label,
  error,
  hint,
  className,
  children,
  ...selectProps
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint}>
      <select id={id} className={["form-input", className].filter(Boolean).join(" ")} {...selectProps}>
        {children}
      </select>
    </FormField>
  );
}

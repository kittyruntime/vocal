import { useId } from "react";
import { FormField } from "./FormField";

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
}) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id}>
      <input
        id={id}
        type="color"
        className="color-field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

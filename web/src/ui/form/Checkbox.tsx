import { useId, type ReactNode } from "react";

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange(next: boolean): void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="checkbox-option">
      <input
        id={id}
        type="checkbox"
        className="checkbox-input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

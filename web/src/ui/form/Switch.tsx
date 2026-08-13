import { useId } from "react";

export function Switch({
  label,
  checked,
  visuallyHiddenLabel,
  onChange,
}: {
  label: string;
  checked: boolean;
  visuallyHiddenLabel?: boolean;
  onChange(next: boolean): void;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <label htmlFor={id} className={visuallyHiddenLabel ? "sr-only" : undefined}>{label}</label>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

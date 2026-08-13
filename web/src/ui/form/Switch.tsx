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
  const labelId = `${id}-label`;
  return (
    <div className="switch-row">
      <label id={labelId} htmlFor={id} className={visuallyHiddenLabel ? "sr-only" : undefined}>{label}</label>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

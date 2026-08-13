import { useEffect, useState } from "react";
import { TextField } from "../ui/form";

type CustomNumberFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
};

export function CustomNumberField({ label, value, min, max, step, onCommit }: CustomNumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string>();
  const [lastValidValue, setLastValidValue] = useState(value);
  const message = `${label} must be between ${min} and ${max}.`;

  useEffect(() => {
    setDraft(String(value));
    setLastValidValue(value);
    setError(undefined);
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value;
    setDraft(nextDraft);

    if (nextDraft.trim() === "") {
      setError(message);
      return;
    }

    const nextValue = Number(nextDraft);
    if (!Number.isFinite(nextValue) || nextValue < min || nextValue > max) {
      setError(message);
      return;
    }

    setError(undefined);
    setLastValidValue(nextValue);
    onCommit(nextValue);
  };

  const handleBlur = () => {
    if (draft.trim() === "") {
      setDraft(String(lastValidValue));
      setError(undefined);
      return;
    }

    const parsedValue = Number(draft);
    if (!Number.isFinite(parsedValue)) {
      setDraft(String(lastValidValue));
      setError(undefined);
      return;
    }

    const clampedValue = Math.min(max, Math.max(min, parsedValue));
    if (clampedValue !== parsedValue) {
      setDraft(String(clampedValue));
      setLastValidValue(clampedValue);
      setError(undefined);
      onCommit(clampedValue);
    }
  };

  return (
    <TextField
      label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      error={error}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

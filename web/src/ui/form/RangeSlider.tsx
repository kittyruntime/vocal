import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { FormField } from "./FormField";

export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange(next: number): void;
  onCommit(next: number): void;
}) {
  const id = useId();
  const currentValueRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  function commit(event: PointerEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) {
    onCommit(currentValueRef.current);
  }

  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        className="form-range"
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          currentValueRef.current = nextValue;
          onChange(nextValue);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </FormField>
  );
}

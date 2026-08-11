import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { FormField } from "./FormField";

const VALUE_CHANGING_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

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

  function commitOnPointerUp(event: PointerEvent<HTMLInputElement>) {
    onCommit(currentValueRef.current);
  }

  function commitOnKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    if (!VALUE_CHANGING_KEYS.has(event.key)) return;
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
        onPointerUp={commitOnPointerUp}
        onKeyUp={commitOnKeyUp}
      />
    </FormField>
  );
}

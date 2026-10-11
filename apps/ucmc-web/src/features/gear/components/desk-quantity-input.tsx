import { useEffect, useState } from "react";

import { Input } from "#/components/ui/input";

/**
 * Whole-number quantity field for the desk's counted rows.
 *
 * Keeps its own text draft so the officer can clear the box to type
 * "12" without the value snapping back to 1 on the first keystroke; the
 * parent only ever sees whole numbers in `[1, max]`. Blur restores the
 * last committed value if the draft was left blank.
 *
 * `text-base` comes from `Input` below `md`: anything smaller and iOS
 * Safari zooms the page on focus, which at a desk on a phone shoves the
 * scan column off-screen.
 */
export function DeskQuantityInput({
  id,
  value,
  onChange,
  max,
  label,
  autoFocus,
  invalid,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
  /** Accessible name — the column header says "Gear", which names
   *  nothing on a row that has no code. */
  label: string;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the parent when it moves the value itself (a second scan of
  // the same bin, a server refusal resetting a row) — but never while
  // the draft already says the same number, or "06" would rewrite to "6"
  // mid-edit.
  useEffect(() => {
    setDraft((d) => (Number(d) === value ? d : String(value)));
  }, [value]);

  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      step={1}
      value={draft}
      aria-label={label}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      disabled={disabled}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const n = Number(next);
        if (next !== "" && Number.isInteger(n) && n >= 1 && n <= max) {
          onChange(n);
        }
      }}
      onBlur={() => setDraft(String(value))}
      className="h-8 w-16 px-2 tabular-nums"
    />
  );
}

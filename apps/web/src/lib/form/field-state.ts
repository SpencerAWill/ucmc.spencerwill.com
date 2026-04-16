/**
 * Derives display-state attributes for form fields — "neutral", "valid",
 * or "invalid" — mapped to `aria-invalid` / `data-valid` attributes that
 * shadcn primitives (Input, Textarea, SelectTrigger, InputGroup) style
 * via built-in CSS rules.
 *
 * The two states use different triggers to give the best typing UX:
 *
 *   **Green (valid)** — appears as soon as `isDirty && !hasErrors &&
 *   hasValue`. "Dirty" means the user has modified the field from its
 *   default. This gives instant positive feedback while the user types
 *   valid content — they don't have to blur first.
 *
 *   **Red (invalid)** — appears only when `isTouched && hasErrors`.
 *   "Touched" means the field has been blurred at least once. This
 *   avoids punishing the user mid-keystroke (e.g. showing a regex error
 *   after typing one digit of an 8-digit M-number).
 *
 *   **Neutral** — any other case (pristine, typing partial content that
 *   hasn't been blurred yet, empty optional field).
 *
 * Intended for `field.state.meta` + `field.state.value` — both are
 * fresh at render time inside `<AppField>` (which subscribes to all
 * field state changes). Do NOT use `useStore` for this — it creates a
 * competing subscription that misses value-only changes.
 */
import type { AnyFieldMeta } from "@tanstack/react-form";

export interface ValidationAttrs {
  "aria-invalid"?: boolean;
  "data-valid"?: "true";
}

function hasValue(value: unknown): boolean {
  if (value === "" || value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

export function fieldValidationAttrs(
  meta: AnyFieldMeta,
  value: unknown,
): ValidationAttrs {
  const hasErrors = meta.errors.length > 0;

  // Red: the user has left the field at least once and it's still invalid.
  if (meta.isTouched && hasErrors) {
    return { "aria-invalid": true };
  }

  // Green: the user has typed something (dirty), it passes validation,
  // and the value is non-empty. Shows immediately while typing — no need
  // to blur first.
  if (meta.isDirty && !hasErrors && hasValue(value)) {
    return { "data-valid": "true" };
  }

  return {};
}

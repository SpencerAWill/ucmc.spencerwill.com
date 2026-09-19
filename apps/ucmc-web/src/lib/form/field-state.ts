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
 *   **Red (invalid)** — appears only when `hasErrors` and the field has
 *   been blurred at least once, or the form has had a submit attempt.
 *   This avoids punishing the user mid-keystroke (e.g. showing "Enter a
 *   valid phone number" after the first digit) and, just as important on
 *   a phone, avoids mounting an error line under the focused control on
 *   every keystroke, which reflows the page under the soft keyboard.
 *
 *   The blur flag is `meta.isBlurred`, **not** `meta.isTouched`: TanStack
 *   Form sets `isTouched` on the first *change* as well as on blur, so a
 *   touched-based check turns red on the first keystroke. The submit
 *   fallback covers Enter / the mobile "Go" key submitting a form whose
 *   fields were never blurred — `handleSubmit` marks fields touched, but
 *   not blurred, so without it those errors would stay hidden.
 *
 *   **Neutral** — any other case (pristine, typing partial content that
 *   hasn't been blurred yet, empty optional field).
 *
 * Intended for `field.state.meta` + `field.state.value` — both are
 * fresh at render time inside `<AppField>` (which subscribes to all
 * field state changes). Do NOT use `useStore` on the field store for
 * this — it creates a competing subscription that misses value-only
 * changes.
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

/**
 * Whether a field's errors should be visible right now: it has errors,
 * and either the user has left the field at least once or the form has
 * had a submit attempt. See the module comment for why this is
 * `isBlurred` rather than `isTouched`.
 */
export function hasVisibleError(
  meta: AnyFieldMeta,
  submitted: boolean,
): boolean {
  return (meta.isBlurred || submitted) && meta.errors.length > 0;
}

export function fieldValidationAttrs(
  meta: AnyFieldMeta,
  value: unknown,
  submitted: boolean,
): ValidationAttrs {
  // Red: the user has left the field (or tried to submit) and it's still invalid.
  if (hasVisibleError(meta, submitted)) {
    return { "aria-invalid": true };
  }

  // Green: the user has typed something (dirty), it passes validation,
  // and the value is non-empty. Shows immediately while typing — no need
  // to blur first.
  if (meta.isDirty && meta.errors.length === 0 && hasValue(value)) {
    return { "data-valid": "true" };
  }

  return {};
}

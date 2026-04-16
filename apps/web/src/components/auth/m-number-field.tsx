/**
 * UC M-number field — a domain-specific form field, not a generic
 * prefix input. Encapsulates every M-number quirk in one place:
 *
 *   - Visual "M" prefix rendered as a shadcn `InputGroupAddon`, so
 *     the user types only 8 digits.
 *   - Input rejects every non-digit keystroke and paste (browser-
 *     level enforcement via `inputMode="numeric"` + a runtime strip).
 *   - Form state is always either `""` (empty) or `M########` — the
 *     server's `^M\d{8}$` regex matches directly with no pre-processing.
 *   - The stored value is the source of truth: pastes that include a
 *     leading "M" (e.g. "M12345678") are normalized, so either form
 *     works.
 *
 * Rendered inside `<form.AppField name="mNumber">` — reads the field
 * via `useFieldContext` and does not need to be registered with
 * `useAppForm`.
 */
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import { useFieldContext } from "#/lib/form/context";
import { fieldValidationAttrs } from "#/lib/form/field-state";
import { FieldErrors } from "#/lib/form/fields";

const M_NUMBER_DIGITS = 8;

export function MNumberField({
  label = "M-number (optional)",
}: {
  label?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value: storedValue } = field.state;
  const validation = fieldValidationAttrs(meta, storedValue);

  // Stored value is "M########"; strip the "M" to derive what the
  // input actually displays.
  const digits = storedValue.startsWith("M")
    ? storedValue.slice(1)
    : storedValue;

  const onChange = (raw: string) => {
    // Accept digits only. Strips any accidental "M" from paste, any
    // letters, spaces, etc. Cap at 8 so the regex can't fail on
    // length.
    const sanitized = raw.replace(/\D/g, "").slice(0, M_NUMBER_DIGITS);
    field.handleChange(sanitized.length > 0 ? `M${sanitized}` : "");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
      <InputGroup>
        <InputGroupAddon align="inline-start">M</InputGroupAddon>
        <InputGroupInput
          id={field.name}
          name={field.name}
          type="text"
          inputMode="numeric"
          // `pattern` is belt-and-suspenders with the onChange strip:
          // browsers that honor it give the user a friendly hint;
          // those that don't still can't submit non-digits because
          // the state never holds any.
          pattern="\d{8}"
          maxLength={M_NUMBER_DIGITS}
          placeholder="12345678"
          value={digits}
          onBlur={field.handleBlur}
          onChange={(e) => onChange(e.target.value)}
          {...validation}
        />
      </InputGroup>
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
  );
}

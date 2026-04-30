// NOTE: field components here do NOT use `useStore(field.store, ...)`
// for meta. Since they render inside `<AppField>` (which already
// subscribes to all field state changes), `field.state.meta` and
// `field.state.value` are always fresh at render time. Adding a
// useStore call would create a competing subscription that only
// triggers on meta changes — missing value changes needed for
// validation-attribute computation (e.g. isDirty + hasValue → green).
import { useEffect, useRef } from "react";
import PhoneInputBase from "react-phone-number-input/input";

import { Button } from "#/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import * as ShadcnSelect from "#/components/ui/select";
import { Slider as ShadcnSlider } from "#/components/ui/slider";
import { Switch as ShadcnSwitch } from "#/components/ui/switch";
import { Textarea as ShadcnTextarea } from "#/components/ui/textarea";
import { useFieldContext, useFormContext } from "#/lib/form/context";
import { fieldValidationAttrs } from "#/lib/form/field-state";

// Matches the `@keyframes form-autofill-detect` rule in `styles.css`.
const AUTOFILL_ANIMATION_NAME = "form-autofill-detect";

// TanStack Form aggregates errors as `Array<string | { message: string }>`
// (string when a plain message is thrown, object when zod issues are
// surfaced). shadcn's `FieldError` expects `Array<{ message?: string }>`,
// so normalize before handing it the array.
function toFieldErrors(
  errors: Array<string | { message: string } | undefined>,
): Array<{ message: string }> {
  return errors
    .map((e) => {
      if (!e) {
        return undefined;
      }
      return typeof e === "string" ? { message: e } : e;
    })
    .filter((e): e is { message: string } => Boolean(e?.message));
}

export function SubscribeButton({ label }: { label: string }) {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => ({
        isSubmitting: state.isSubmitting,
        canSubmit: state.canSubmit,
        isDefaultValue: state.isDefaultValue,
      })}
    >
      {({ isSubmitting, canSubmit, isDefaultValue }) => (
        // `isDefaultValue` is the value-comparison flag (current values
        // === defaults), not the interaction flag — so the button
        // re-disables if the user types a change and then reverts it.
        // `isDirty`/`isPristine` are interaction-sticky and would stay
        // enabled after a revert, which isn't what we want for a
        // "nothing to save" gate.
        <Button
          type="submit"
          disabled={isSubmitting || !canSubmit || isDefaultValue}
        >
          {isSubmitting ? "Submitting…" : label}
        </Button>
      )}
    </form.Subscribe>
  );
}

/**
 * General-purpose single-line text input bound to a TanStack Form
 * field. If you need an addon, a prefix, numeric-only input, or
 * custom display↔value mapping, build a dedicated field component
 * that reads `useFieldContext()` directly rather than growing props
 * here.
 */
export function TextField({
  label,
  description,
  placeholder,
  type = "text",
  autoComplete,
  maxLength,
  minLength,
  readOnly,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url" | "password";
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  readOnly?: boolean;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Browser autofill (esp. Chrome on autoComplete="name") sets the
  // input's DOM value but does NOT fire React's onChange handler
  // until the user interacts (focus + blur). For controlled
  // TanStack Form inputs that means `field.state.value` stays at
  // its empty default while the field visibly contains text — so
  // it shows neutral, and only flips to green on blur (when the
  // browser finally fires a synthetic change).
  //
  // The 1ms `form-autofill-detect` animation declared in
  // styles.css fires when the `:autofill` pseudo-class is set,
  // giving us an `animationstart` event we can listen for and
  // push the DOM value into form state ourselves.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const handler = (e: AnimationEvent) => {
      if (e.animationName !== AUTOFILL_ANIMATION_NAME) {
        return;
      }
      if (input.value !== field.state.value) {
        field.handleChange(input.value);
      }
    };
    input.addEventListener("animationstart", handler);
    return () => input.removeEventListener("animationstart", handler);
  }, [field]);

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        ref={inputRef}
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        minLength={minLength}
        value={field.state.value}
        placeholder={placeholder}
        readOnly={readOnly}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        {...validation}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

export function TextArea({
  label,
  description,
  rows = 3,
  maxLength,
  placeholder,
}: {
  label: string;
  description?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <ShadcnTextarea
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => field.handleChange(e.target.value)}
        {...validation}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

/**
 * Radix-backed Select. Notes on the pitfalls:
 *   - Radix Select rejects `value=""` on items; we also pass `undefined`
 *     (not `""`) as the root value when the form field is empty so the
 *     placeholder renders correctly.
 *   - `position="popper"` is the default for most shadcn forms; the
 *     legacy `item-aligned` mode can render a zero-height dropdown
 *     when no option is selected yet.
 */
export function Select({
  label,
  description,
  values,
  placeholder,
}: {
  label: string;
  description?: string;
  values: Array<{ label: string; value: string }>;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {/* Always pass the raw string as `value` so Radix stays controlled
          for the component's lifetime. An empty string won't match any
          SelectItem, so the placeholder still renders. */}
      <ShadcnSelect.Select
        name={field.name}
        value={field.state.value}
        onValueChange={(v) => {
          field.handleChange(v);
          field.handleBlur();
        }}
      >
        <ShadcnSelect.SelectTrigger
          id={field.name}
          className="w-full"
          {...validation}
        >
          <ShadcnSelect.SelectValue placeholder={placeholder ?? "Select…"} />
        </ShadcnSelect.SelectTrigger>
        <ShadcnSelect.SelectContent position="popper">
          {values.map((opt) => (
            <ShadcnSelect.SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </ShadcnSelect.SelectItem>
          ))}
        </ShadcnSelect.SelectContent>
      </ShadcnSelect.Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

/**
 * Phone-number input that auto-formats as the user types and stores
 * the value as an E.164 string (e.g. `+15135551234`) in form state.
 * Defaults to US-national formatting — `(513) 555-1234` — so members
 * don't have to type the country code.
 *
 * Uses `react-phone-number-input/input` (the bare input variant; the
 * full component adds a country-flag dropdown that we don't want for a
 * US-focused club app). The inner input renders with shadcn's Input
 * styling via the `inputComponent` prop.
 */
export function PhoneField({
  label,
  description,
  country = "US",
  autoComplete = "tel",
  placeholder,
}: {
  label: string;
  description?: string;
  country?: "US";
  autoComplete?: string;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <PhoneInputBase
        id={field.name}
        name={field.name}
        country={country}
        autoComplete={autoComplete}
        placeholder={placeholder ?? "(555) 555-5555"}
        value={field.state.value || undefined}
        onChange={(v) => field.handleChange(v ?? "")}
        onBlur={field.handleBlur}
        inputComponent={Input}
        {...validation}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

export function Slider({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  const field = useFieldContext<number>();
  const { meta } = field.state;

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <ShadcnSlider
        id={field.name}
        onBlur={field.handleBlur}
        value={[field.state.value]}
        onValueChange={(v) => field.handleChange(v[0])}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

export function Switch({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  const field = useFieldContext<boolean>();
  const { meta } = field.state;

  return (
    <Field orientation="horizontal" className="gap-2">
      <ShadcnSwitch
        id={field.name}
        name={field.name}
        onBlur={field.handleBlur}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {meta.isTouched ? (
        <FieldError errors={toFieldErrors(meta.errors)} />
      ) : null}
    </Field>
  );
}

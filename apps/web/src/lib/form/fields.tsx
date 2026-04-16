// NOTE: field components here do NOT use `useStore(field.store, ...)`
// for meta. Since they render inside `<AppField>` (which already
// subscribes to all field state changes), `field.state.meta` and
// `field.state.value` are always fresh at render time. Adding a
// useStore call would create a competing subscription that only
// triggers on meta changes — missing value changes needed for
// validation-attribute computation (e.g. isDirty + hasValue → green).
import PhoneInputBase from "react-phone-number-input/input";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import * as ShadcnSelect from "#/components/ui/select";
import { Slider as ShadcnSlider } from "#/components/ui/slider";
import { Switch as ShadcnSwitch } from "#/components/ui/switch";
import { Textarea as ShadcnTextarea } from "#/components/ui/textarea";
import { useFieldContext, useFormContext } from "#/lib/form/context";
import { fieldValidationAttrs } from "#/lib/form/field-state";

export function SubscribeButton({ label }: { label: string }) {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => ({
        isSubmitting: state.isSubmitting,
        canSubmit: state.canSubmit,
      })}
    >
      {({ isSubmitting, canSubmit }) => (
        <Button type="submit" disabled={isSubmitting || !canSubmit}>
          {isSubmitting ? "Submitting…" : label}
        </Button>
      )}
    </form.Subscribe>
  );
}

/**
 * Renders per-field validation errors under an input. Exported so
 * domain-specific fields (e.g. MNumberField) can render the same
 * error presentation without duplicating the list markup.
 *
 * Deduplicates by message — tanstack-form aggregates errors across
 * every configured trigger (onChange, onBlur, onSubmit), so the same
 * zod message often appears two or three times in `meta.errors`. We
 * care about unique messages, not how many triggers fired them.
 */
export function FieldErrors({
  errors,
}: {
  errors: Array<string | { message: string }>;
}) {
  const messages = Array.from(
    new Set(errors.map((e) => (typeof e === "string" ? e : e.message))),
  );
  if (messages.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-0.5 text-xs text-destructive">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/**
 * General-purpose single-line text input bound to a TanStack Form
 * field. If you need an addon, a prefix, numeric-only input, or
 * custom display↔value mapping, build a dedicated field component
 * that reads `useFieldContext()` directly rather than growing props
 * here — see `components/auth/m-number-field.tsx` for the pattern.
 */
export function TextField({
  label,
  placeholder,
  type = "text",
  autoComplete,
  maxLength,
  minLength,
  readOnly,
}: {
  label: string;
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

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
      <Input
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
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
  );
}

export function TextArea({
  label,
  rows = 3,
  maxLength,
}: {
  label: string;
  rows?: number;
  maxLength?: number;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
      <ShadcnTextarea
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => field.handleChange(e.target.value)}
        {...validation}
      />
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
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
  values,
  placeholder,
}: {
  label: string;
  values: Array<{ label: string; value: string }>;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
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
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
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
  country = "US",
  autoComplete = "tel",
  placeholder,
}: {
  label: string;
  country?: "US";
  autoComplete?: string;
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  const { meta, value } = field.state;
  const validation = fieldValidationAttrs(meta, value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
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
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
  );
}

export function Slider({ label }: { label: string }) {
  const field = useFieldContext<number>();
  const { meta } = field.state;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {label}
      </Label>
      <ShadcnSlider
        id={field.name}
        onBlur={field.handleBlur}
        value={[field.state.value]}
        onValueChange={(v) => field.handleChange(v[0])}
      />
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
  );
}

export function Switch({ label }: { label: string }) {
  const field = useFieldContext<boolean>();
  const { meta } = field.state;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <ShadcnSwitch
          id={field.name}
          name={field.name}
          onBlur={field.handleBlur}
          checked={field.state.value}
          onCheckedChange={(checked) => field.handleChange(checked)}
        />
        <Label htmlFor={field.name}>{label}</Label>
      </div>
      {meta.isTouched ? <FieldErrors errors={meta.errors} /> : null}
    </div>
  );
}

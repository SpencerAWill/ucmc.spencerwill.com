/**
 * Renders the attribute definitions attached to one type, at one
 * level, as a block of controls.
 *
 * Shared by the item form and the model form because the definitions
 * are the same rows and the controls should not drift apart — a select
 * that lists options in definition order in one place and alphabetical
 * order in the other is exactly the bug the explicit ordering exists to
 * prevent.
 *
 * State is held by the caller as a `defPublicId → raw string` map, the
 * same shape the wire takes, so there is no third representation
 * between the control and the column.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import { Switch } from "#/components/ui/switch";
import { gearAttributeDefsQueryOptions } from "#/features/gear/api/queries";
import type { GearAttributeValueDto } from "#/features/gear/lib/attributes";
import { attributeValueToFormValue } from "#/features/gear/lib/attributes";
import type { GearAttributeLevel } from "#/features/gear/server/gear-fns";

export type AttributeFormValues = Record<string, string>;

/**
 * Seeds form state from values already recorded. Values whose
 * definition isn't in `defPublicIds` are dropped, which is how the item
 * form ignores the model-level answers riding along in the same list.
 */
export function attributeFormValuesFrom(
  values: GearAttributeValueDto[],
  defPublicIds: Set<string>,
): AttributeFormValues {
  const out: AttributeFormValues = {};
  for (const value of values) {
    if (defPublicIds.has(value.defPublicId)) {
      out[value.defPublicId] = attributeValueToFormValue(value);
    }
  }
  return out;
}

export function GearAttributeFields({
  typePublicId,
  level,
  values,
  onChange,
  idPrefix,
}: {
  typePublicId: string | null;
  level: GearAttributeLevel;
  values: AttributeFormValues;
  onChange: (values: AttributeFormValues) => void;
  /** Distinguishes the item block from the model block when both are
   *  mounted in the same sheet — two `<label for>` pairs sharing an id
   *  focus the wrong control. */
  idPrefix: string;
}) {
  const { data: defs } = useQuery({
    ...gearAttributeDefsQueryOptions({ typePublicId, level }),
    enabled: typePublicId !== null,
  });

  // A Switch has no unanswered position: it renders "No" from the
  // moment it mounts, so "No" is what the officer is looking at and
  // what the form has to send. Left absent, `attributeInputsFrom`
  // emits no key for it and the server refuses a *required* boolean
  // the officer answered by leaving it alone — the only way to say
  // "No" would be toggling on and back off. Every other kind keeps a
  // real blank, which the server reads as cleared.
  useEffect(() => {
    if (!defs) return;
    const unseeded = defs.filter(
      (def) => def.kind === "boolean" && !(def.publicId in values),
    );
    if (unseeded.length === 0) return;
    onChange({
      ...values,
      ...Object.fromEntries(unseeded.map((def) => [def.publicId, "false"])),
    });
  }, [defs, values, onChange]);

  if (typePublicId === null || !defs || defs.length === 0) {
    return null;
  }

  const set = (defPublicId: string, value: string) => {
    onChange({ ...values, [defPublicId]: value });
  };

  return (
    <div className="space-y-4">
      {defs.map((def) => {
        const id = `${idPrefix}-attr-${def.publicId}`;
        const value = values[def.publicId] ?? "";
        return (
          <div key={def.publicId} className="space-y-1.5">
            <Label htmlFor={id}>
              {def.label}
              {def.required ? (
                <span className="text-destructive" aria-hidden>
                  *
                </span>
              ) : null}
            </Label>
            {def.kind === "select" ? (
              <NativeSelect
                id={id}
                className="w-full"
                value={value}
                onChange={(e) => set(def.publicId, e.target.value)}
              >
                {/* Always offered, even on a required attribute: the
                 * server refuses the blank, which is a message, where a
                 * dropdown with no empty state silently pre-answers. */}
                <option value="">—</option>
                {(def.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            ) : def.kind === "boolean" ? (
              <div className="flex h-9 items-center">
                <Switch
                  id={id}
                  checked={value === "true"}
                  onCheckedChange={(checked) =>
                    set(def.publicId, checked ? "true" : "false")
                  }
                />
              </div>
            ) : def.kind === "number" ? (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => set(def.publicId, e.target.value)}
                />
                {def.unit ? (
                  <span className="text-sm text-muted-foreground">
                    {def.unit}
                  </span>
                ) : null}
              </div>
            ) : (
              <Input
                id={id}
                value={value}
                maxLength={500}
                onChange={(e) => set(def.publicId, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The wire shape: every definition rendered is sent, including the
 *  blanks, so clearing an answer is expressible. */
export function attributeInputsFrom(values: AttributeFormValues) {
  return Object.entries(values).map(([defPublicId, value]) => ({
    defPublicId,
    value: value.length === 0 ? null : value,
  }));
}

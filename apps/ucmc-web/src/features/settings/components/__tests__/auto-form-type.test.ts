import { describe, expect, it } from "vitest";

import { autoFormType } from "#/features/settings/components/auto-form/introspect";
import { SETTINGS } from "#/server/settings/settings-registry";
import type { SettingKey } from "#/server/settings/settings-registry";

/**
 * `SettingRow` picks its renderer from `autoFormType`, and `"unknown"`
 * has no branch: the row falls through to a text `<Input>` fed
 * `String(value)` and compares drafts with `!==`. For a scalar that is
 * correct; for an array or object it renders `"1,3"` into a control that
 * writes a string back, and `isDirty` compares by reference.
 *
 * So the invariant is not "this one setting is a string" but **every
 * setting is a shape the row can actually render**. The day somebody adds
 * the registry's first non-scalar, this is what tells them the `editor`
 * slot has to be built first rather than letting /settings quietly
 * corrupt the value.
 */
describe("every setting is renderable by the auto-form", () => {
  it.each(Object.keys(SETTINGS) as SettingKey[])("%s", (key) => {
    expect(autoFormType(SETTINGS[key])).not.toBe("unknown");
  });
});

describe("gear.caveOpenDays", () => {
  const schema = SETTINGS["gear.caveOpenDays"];

  it("renders as a string row despite carrying a refinement", () => {
    // `.refine()` must not wrap the schema in something `unwrapDefault`
    // can't see through — that would demote the row to `unknown` and
    // swap its editor out, which is invisible until someone opens
    // /settings.
    expect(autoFormType(schema)).toBe("string");
  });

  it("accepts the weekday forms an admin would type", () => {
    for (const value of ["Wed", "wednesday", "Mon,Wed", "", "  Wed , Fri "]) {
      expect(() => schema.parse(value)).not.toThrow();
    }
  });

  it("rejects a value that isn't a weekday list", () => {
    // The refusal is the point: a typo stored here would leave the desk
    // with no open days and the roll-forward silently inert, which looks
    // exactly like the feature not existing.
    expect(() => schema.parse("Wensday")).toThrow();
    expect(() => schema.parse("Wed,tomorrow")).toThrow();
  });
});

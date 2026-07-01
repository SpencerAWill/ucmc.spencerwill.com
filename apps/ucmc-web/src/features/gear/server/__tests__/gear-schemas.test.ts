/**
 * Wire-shape tests for the zod input validators exposed by
 * `gear-fns.ts`. These exist as a thin safety net so a future edit to
 * a schema (e.g. relaxing a bound while debugging) doesn't silently
 * widen what the server accepts. Pure zod parsing — no D1 / R2
 * dependency.
 */
import { describe, expect, it } from "vitest";

import { createGearInputSchema } from "#/features/gear/server/gear-fns";

const baseInput = {
  typePublicId: "type1",
  code: "CH1",
  description: "Test",
  thumbnailDataUrl: null,
  acquiredAt: null,
  acquisitionCostCents: null,
  notesMarkdown: null,
  condition: "serviceable" as const,
  tagPublicIds: [] as string[],
};

describe("createGearInputSchema acquiredAt range", () => {
  it("accepts null (no acquisition date)", () => {
    expect(() => createGearInputSchema.parse(baseInput)).not.toThrow();
  });

  it("accepts a typical date in ms-since-epoch", () => {
    expect(() =>
      createGearInputSchema.parse({
        ...baseInput,
        acquiredAt: Date.UTC(2025, 0, 1),
      }),
    ).not.toThrow();
  });

  it("rejects negative ms (pre-epoch typo)", () => {
    expect(() =>
      createGearInputSchema.parse({ ...baseInput, acquiredAt: -1 }),
    ).toThrow();
  });

  it("rejects dates past the year-2100 cap", () => {
    // Date.parse of `"20240101"` (the most common CSV typo) yields a
    // year well past 2100. The cap is the floor against that.
    const past2100 = Date.UTC(2100, 0, 2);
    expect(() =>
      createGearInputSchema.parse({ ...baseInput, acquiredAt: past2100 }),
    ).toThrow();
  });

  it("rejects non-integer timestamps", () => {
    expect(() =>
      createGearInputSchema.parse({ ...baseInput, acquiredAt: 1.5 }),
    ).toThrow();
  });
});

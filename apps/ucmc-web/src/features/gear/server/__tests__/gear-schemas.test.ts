/**
 * Wire-shape tests for the zod input validators exposed by
 * `gear-fns.ts`. These exist as a thin safety net so a future edit to
 * a schema (e.g. relaxing a bound while debugging) doesn't silently
 * widen what the server accepts. Pure zod parsing — no D1 / R2
 * dependency.
 */
import { describe, expect, it } from "vitest";

import {
  checkinLoansInputSchema,
  checkoutLoansInputSchema,
  createGearInputSchema,
  MAX_COUNTED_LOAN_QUANTITY,
} from "#/features/gear/server/gear-fns";

const baseInput = {
  typePublicId: "type1",
  code: "CH1",
  thumbnailDataUrl: null,
  acquiredAt: null,
  acquisitionCostCents: null,
  modelPublicId: "mdl_test",
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

describe("checkoutLoansInputSchema rows", () => {
  const base = { memberPublicId: "m1", notes: null };

  it("accepts a mixed batch of a coded piece and a counted quantity", () => {
    expect(() =>
      checkoutLoansInputSchema.parse({
        ...base,
        items: [
          { kind: "coded", gearPublicId: "g1", durationDays: 7 },
          {
            kind: "counted",
            modelPublicId: "m-draws",
            quantity: 6,
            durationDays: 7,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("requires the discriminant, so a counted row can't fall through to coded", () => {
    expect(() =>
      checkoutLoansInputSchema.parse({
        ...base,
        items: [{ modelPublicId: "m-draws", quantity: 6, durationDays: 7 }],
      }),
    ).toThrow();
  });

  it("bounds the quantity to 1…MAX_COUNTED_LOAN_QUANTITY", () => {
    const row = (quantity: number) => ({
      ...base,
      items: [
        { kind: "counted", modelPublicId: "m", quantity, durationDays: 7 },
      ],
    });
    expect(() => checkoutLoansInputSchema.parse(row(0))).toThrow();
    expect(() => checkoutLoansInputSchema.parse(row(1.5))).toThrow();
    expect(() =>
      checkoutLoansInputSchema.parse(row(MAX_COUNTED_LOAN_QUANTITY)),
    ).not.toThrow();
    expect(() =>
      checkoutLoansInputSchema.parse(row(MAX_COUNTED_LOAN_QUANTITY + 1)),
    ).toThrow();
  });

  it("refuses the same model twice in one batch", () => {
    const counted = {
      kind: "counted",
      modelPublicId: "m-draws",
      quantity: 2,
      durationDays: 7,
    };
    expect(() =>
      checkoutLoansInputSchema.parse({ ...base, items: [counted, counted] }),
    ).toThrow();
  });
});

describe("checkinLoansInputSchema rows", () => {
  const counted = {
    kind: "counted",
    loanPublicId: "loan1",
    quantity: 3,
    notes: null,
  };

  it("accepts a coded piece and a counted return in one batch", () => {
    expect(() =>
      checkinLoansInputSchema.parse({
        items: [
          {
            kind: "coded",
            gearPublicId: "g1",
            conditionAtReturn: null,
            notes: null,
          },
          counted,
        ],
      }),
    ).not.toThrow();
  });

  it("refuses a zero-unit return and the same loan twice", () => {
    expect(() =>
      checkinLoansInputSchema.parse({ items: [{ ...counted, quantity: 0 }] }),
    ).toThrow();
    expect(() =>
      checkinLoansInputSchema.parse({ items: [counted, counted] }),
    ).toThrow();
  });
});

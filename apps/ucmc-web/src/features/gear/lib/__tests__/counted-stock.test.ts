import { describe, expect, it } from "vitest";

import { countedTakeable } from "#/features/gear/lib/counted-stock";

describe("countedTakeable", () => {
  const terms = { serviceable: 10, onLoan: 3, held: 4 };

  it("subtracts what is out and what is held", () => {
    expect(countedTakeable(terms)).toBe(3);
  });

  it("lets an override release held units, never units on loan", () => {
    expect(countedTakeable(terms, { respectHolds: false })).toBe(7);
  });

  it("floors at zero when holds overlap what is already out", () => {
    expect(countedTakeable({ serviceable: 4, onLoan: 3, held: 4 })).toBe(0);
  });
});

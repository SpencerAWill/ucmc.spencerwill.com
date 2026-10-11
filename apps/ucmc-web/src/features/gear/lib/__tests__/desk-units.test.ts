import { describe, expect, it } from "vitest";

import { deskUnits, sumDeskUnits } from "#/features/gear/lib/desk-units";

describe("deskUnits", () => {
  it("counts a coded piece as one and a counted row as its quantity", () => {
    expect(deskUnits({ kind: "coded" })).toBe(1);
    expect(deskUnits({ kind: "counted", quantity: 6 })).toBe(6);
  });

  it("sums a mixed batch in pieces — a harness and six draws is seven", () => {
    expect(
      sumDeskUnits([{ kind: "coded" }, { kind: "counted", quantity: 6 }]),
    ).toBe(7);
    expect(sumDeskUnits([])).toBe(0);
  });
});

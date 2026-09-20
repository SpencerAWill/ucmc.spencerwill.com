import { describe, expect, it } from "vitest";

import {
  TERMINAL_STATUSES,
  availabilityBadge,
  isTerminalStatus,
} from "#/features/gear/lib/labels";

describe("isTerminalStatus", () => {
  it("covers every terminal status, not just `retired`", () => {
    // Spelled `status === "retired"` in five components, which is how a
    // lost item ended up offering "Retire" with no way back to active.
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    expect(isTerminalStatus("active")).toBe(false);
  });
});

describe("availabilityBadge", () => {
  it("names the real status rather than collapsing to Retired", () => {
    // The rollup buckets all three under `retired` — right for "can I
    // borrow this", wrong as the word on the card.
    expect(
      availabilityBadge({ status: "lost", availability: "retired" }),
    ).toEqual({ label: "Lost", variant: "destructive" });
    expect(
      availabilityBadge({ status: "disposed", availability: "retired" }),
    ).toEqual({ label: "Disposed", variant: "outline" });
    expect(
      availabilityBadge({ status: "retired", availability: "retired" }),
    ).toEqual({ label: "Retired", variant: "outline" });
  });

  it("leaves every other bucket to the rollup", () => {
    expect(
      availabilityBadge({ status: "active", availability: "on_loan" }),
    ).toEqual({ label: "On loan", variant: "outline" });
    expect(
      availabilityBadge({ status: "active", availability: "available" }),
    ).toEqual({ label: "Available", variant: "default" });
  });
});

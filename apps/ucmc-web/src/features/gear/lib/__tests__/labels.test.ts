import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  TERMINAL_STATUSES,
  availabilityBadge,
  availabilityNote,
  isOverdue,
  isTerminalStatus,
} from "#/features/gear/lib/labels";

const inDays = (n: number): Temporal.Instant =>
  Temporal.Now.instant().add({ hours: n * 24 });

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

  it("calls a loan past its date overdue rather than on loan", () => {
    // The gear surfaces used to render a loan two weeks gone as a calm
    // "On loan · back Sep 8", while /gear/loans said "Overdue".
    expect(
      availabilityBadge({
        status: "active",
        availability: "on_loan",
        availableFrom: inDays(-14),
      }),
    ).toEqual({ label: "Overdue", variant: "destructive" });
    expect(
      availabilityBadge({
        status: "active",
        availability: "on_loan",
        availableFrom: inDays(3),
      }),
    ).toEqual({ label: "On loan", variant: "outline" });
  });
});

describe("isOverdue", () => {
  it("is false for a missing date rather than throwing", () => {
    expect(isOverdue(null)).toBe(false);
    expect(isOverdue(undefined)).toBe(false);
  });
});

describe("availabilityNote", () => {
  const base = {
    availableFrom: null,
    whereabouts: "cave" as const,
    holdReason: null,
  };

  it("explains an unavailable piece that no condition badge explains", () => {
    // `Unavailable` on its own was the whole story for these three —
    // the cases with nothing else on the row to account for them.
    expect(
      availabilityNote({
        ...base,
        availability: "unavailable",
        whereabouts: "repair",
      }),
    ).toBe("at repair");
    expect(
      availabilityNote({
        ...base,
        availability: "unavailable",
        whereabouts: "missing",
      }),
    ).toBe("missing");
    expect(
      availabilityNote({
        ...base,
        availability: "unavailable",
        whereabouts: "officer",
      }),
    ).toBe("with an officer");
  });

  it("says nothing extra when the condition badge already has", () => {
    // An unsafe piece sitting in the cave gets an `Unsafe` badge beside
    // the rollup; "in the cave" underneath it would be noise.
    expect(
      availabilityNote({ ...base, availability: "unavailable" }),
    ).toBeNull();
    expect(availabilityNote({ ...base, availability: "available" })).toBeNull();
  });

  it("gives the hold's reason, which is written for this audience", () => {
    expect(
      availabilityNote({
        ...base,
        availability: "on_hold",
        holdReason: "Held for the Red River trip",
      }),
    ).toBe("Held for the Red River trip");
  });

  it("distinguishes a loan coming back from one already late", () => {
    expect(
      availabilityNote({
        ...base,
        availability: "on_loan",
        availableFrom: inDays(-14),
      }),
    ).toMatch(/^was due /);
    expect(
      availabilityNote({
        ...base,
        availability: "on_loan",
        availableFrom: inDays(3),
      }),
    ).toMatch(/^back /);
  });
});

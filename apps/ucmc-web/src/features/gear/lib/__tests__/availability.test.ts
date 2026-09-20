import { describe, expect, it } from "vitest";

import {
  BLOCKED_REASON_MESSAGE,
  CHECKOUT_BLOCKED_REASONS,
  gearAvailability,
  isOverridableBlock,
  itemBlockedReason,
} from "#/features/gear/lib/availability";
import type { AvailabilityInput } from "#/features/gear/lib/availability";

const base: AvailabilityInput = {
  status: "active",
  condition: "serviceable",
  whereabouts: "cave",
  hasOpenLoan: false,
  hasActiveHold: false,
};

describe("gearAvailability", () => {
  it("is available only when every axis is clear", () => {
    expect(gearAvailability(base)).toBe("available");
  });

  it.each(["retired", "lost", "disposed"] as const)(
    "reports %s as retired — a terminal status outranks everything",
    (status) => {
      // Even with every other axis screaming, a written-off item is just
      // gone. This is the precedence that stops "lost + needs_repair"
      // showing up in a member's repair queue.
      expect(
        gearAvailability({
          ...base,
          status,
          condition: "unsafe",
          whereabouts: "missing",
          hasActiveHold: true,
        }),
      ).toBe("retired");
    },
  );

  it("prefers on_loan over a condition problem", () => {
    // Deliberate: an open loan resolves on a known date, and the
    // borrower may well be the person who reported the damage at
    // check-in. "Back Thursday" beats "needs repair" for a member.
    expect(
      gearAvailability({
        ...base,
        hasOpenLoan: true,
        condition: "needs_repair",
      }),
    ).toBe("on_loan");
  });

  it.each(["needs_repair", "unsafe"] as const)(
    "reports %s as unavailable",
    (condition) => {
      expect(gearAvailability({ ...base, condition })).toBe("unavailable");
    },
  );

  it.each(["repair", "officer", "missing"] as const)(
    "reports whereabouts %s as unavailable",
    (whereabouts) => {
      expect(gearAvailability({ ...base, whereabouts })).toBe("unavailable");
    },
  );

  it("ranks a hold below a real problem", () => {
    // A hold is the softest block: officer-overridable and self-expiring.
    // An item that is both held and broken is reported as the thing
    // somebody has to fix.
    expect(
      gearAvailability({
        ...base,
        hasActiveHold: true,
        condition: "needs_repair",
      }),
    ).toBe("unavailable");
    expect(gearAvailability({ ...base, hasActiveHold: true })).toBe("on_hold");
  });
});

describe("isOverridableBlock", () => {
  it("lets an officer past a hold or a repair flag", () => {
    expect(isOverridableBlock("on_hold")).toBe(true);
    expect(isOverridableBlock("needs_repair")).toBe(true);
  });

  it("never lets anyone past unsafe", () => {
    // A cored sheath does not go out, whoever is asking. If this ever
    // flips, it should be a deliberate decision with the cave, not a
    // refactor.
    expect(isOverridableBlock("unsafe")).toBe(false);
  });

  it("treats every other reason as a hard stop", () => {
    for (const reason of [
      "retired",
      "on_loan",
      "not_in_cave",
      "no_code",
      "not_waiver_current",
      "has_overdue",
    ] as const) {
      expect(isOverridableBlock(reason)).toBe(false);
    }
  });
});

describe("itemBlockedReason", () => {
  const item = {
    status: "active" as const,
    condition: "serviceable" as const,
    whereabouts: "cave" as const,
    availability: "available" as const,
    code: "CH93",
  };

  it("is null for a piece a member can simply take", () => {
    expect(itemBlockedReason(item)).toBeNull();
  });

  it("names each refusal the browse surfaces have to explain", () => {
    expect(itemBlockedReason({ ...item, status: "lost" })).toBe("retired");
    expect(itemBlockedReason({ ...item, code: null })).toBe("no_code");
    expect(itemBlockedReason({ ...item, availability: "on_loan" })).toBe(
      "on_loan",
    );
    expect(itemBlockedReason({ ...item, condition: "unsafe" })).toBe("unsafe");
    expect(itemBlockedReason({ ...item, condition: "needs_repair" })).toBe(
      "needs_repair",
    );
    expect(itemBlockedReason({ ...item, whereabouts: "repair" })).toBe(
      "not_in_cave",
    );
    expect(itemBlockedReason({ ...item, availability: "on_hold" })).toBe(
      "on_hold",
    );
  });

  it("tells unsafe and needs_repair apart where the rollup can't", () => {
    // Both collapse to `unavailable` in `gearAvailability`, but one is a
    // hard stop and the other is something the desk can wave through, so
    // the member-facing message has to differ.
    const unsafe = itemBlockedReason({ ...item, condition: "unsafe" });
    const repair = itemBlockedReason({ ...item, condition: "needs_repair" });
    expect(unsafe).not.toBe(repair);
    expect(isOverridableBlock(unsafe!)).toBe(false);
    expect(isOverridableBlock(repair!)).toBe(true);
  });

  it("prefers no_code over anything else fixable, whatever else is wrong", () => {
    // It is the one refusal with an obvious next step, and it applies
    // however the rest of the row reads.
    expect(
      itemBlockedReason({
        ...item,
        code: null,
        condition: "unsafe",
        whereabouts: "missing",
      }),
    ).toBe("no_code");
  });

  it("has a message for every reason it can return", () => {
    for (const reason of CHECKOUT_BLOCKED_REASONS) {
      expect(BLOCKED_REASON_MESSAGE[reason]).toBeTruthy();
    }
  });
});

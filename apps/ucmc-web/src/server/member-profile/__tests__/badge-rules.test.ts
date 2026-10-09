import { describe, expect, it } from "vitest";

import {
  BADGES,
  BADGE_KEYS,
  BADGE_SHAPES,
  isBadgeKey,
  isBadgeLive,
} from "../badge-registry";
import type { BadgeInputs } from "../badge-rules";
import {
  awardedBadges,
  packMuleTier,
  showcaseBadges,
  tenureBadgeFor,
  tenureBadgesFor,
} from "../badge-rules";

const NOBODY: BadgeInputs = {
  completedSeasons: 0,
  gearLoans: 0,
  onTimeReturnStreak: 0,
  sweepsParticipated: 0,
  isOfficer: false,
};

const keysOf = (inputs: Partial<BadgeInputs>) =>
  awardedBadges({ ...NOBODY, ...inputs }).map((b) => b.key);

describe("badge registry", () => {
  it("names an artwork file and a shape for every badge", () => {
    for (const key of BADGE_KEYS) {
      const badge = BADGES[key];
      expect(badge.art, `${key} art`).toMatch(/\.(svg|png|webp)$/);
      expect(BADGE_SHAPES, `${key} shape`).toContain(badge.shape);
    }
  });

  it("narrows only its own keys", () => {
    expect(isBadgeKey("white_oak")).toBe(true);
    expect(isBadgeKey("nope")).toBe(false);
    // `Object.hasOwn`, not `in` — `in` walks the prototype chain and
    // would narrow these to a valid key, then index the catalog to a
    // function.
    expect(isBadgeKey("constructor")).toBe(false);
    expect(isBadgeKey("toString")).toBe(false);
  });

  it("points every unearnable badge at the placeholder artwork", () => {
    // The pairing is the contract: a badge that can't be earned yet
    // must not ship art implying it can, and a live badge must not be
    // left on the placeholder.
    for (const key of BADGE_KEYS) {
      const badge = BADGES[key];
      expect(badge.art === "coming-soon.svg", `${key}`).toBe(
        badge.blockedBy !== null,
      );
    }
  });
});

describe("tenureBadgeFor", () => {
  it("returns nothing below one season", () => {
    expect(tenureBadgeFor(0)).toBeNull();
  });

  it("returns the top rung reached, not every rung", () => {
    expect(tenureBadgeFor(1)).toBe("redbud");
    expect(tenureBadgeFor(2)).toBe("pawpaw");
    expect(tenureBadgeFor(3)).toBe("hemlock");
    expect(tenureBadgeFor(4)).toBe("hickory");
    expect(tenureBadgeFor(5)).toBe("white_oak");
  });

  it("holds at the top rung for a long-serving member", () => {
    expect(tenureBadgeFor(9)).toBe("white_oak");
  });
});

describe("tenureBadgesFor", () => {
  it("returns every rung reached, not only the top one", () => {
    // The catalog renders the whole ladder, so a member three
    // seasons in must not see Redbud drawn as unearned — they
    // finished that season.
    expect(tenureBadgesFor(3)).toEqual(["redbud", "pawpaw", "hemlock"]);
  });

  it("is empty during a first season", () => {
    expect(tenureBadgesFor(0)).toEqual([]);
  });

  it("stops at the top rung for a long-serving member", () => {
    expect(tenureBadgesFor(12)).toEqual([
      "redbud",
      "pawpaw",
      "hemlock",
      "hickory",
      "white_oak",
    ]);
  });
});

describe("showcaseBadges", () => {
  it("keeps only the current tenure rung", () => {
    // Four shelf slots filled with Redbud, Pawpaw, Hemlock and
    // Hickory would bury everything the member actually did.
    const awards = awardedBadges({
      ...NOBODY,
      completedSeasons: 4,
      gearLoans: 1,
    });
    expect(awards.map((b) => b.key)).toEqual([
      "redbud",
      "pawpaw",
      "hemlock",
      "hickory",
      "first_rental",
    ]);
    expect(showcaseBadges(awards).map((b) => b.key)).toEqual([
      "hickory",
      "first_rental",
    ]);
  });

  it("leaves a badge set with no tenure rungs alone", () => {
    const awards = awardedBadges({ ...NOBODY, gearLoans: 1, isOfficer: true });
    expect(showcaseBadges(awards)).toEqual(awards);
  });
});

describe("packMuleTier", () => {
  it("awards nothing below the bronze threshold", () => {
    expect(packMuleTier(9)).toBeNull();
  });

  it("steps at exactly 10, 25 and 50", () => {
    expect(packMuleTier(10)).toBe("bronze");
    expect(packMuleTier(24)).toBe("bronze");
    expect(packMuleTier(25)).toBe("silver");
    expect(packMuleTier(49)).toBe("silver");
    expect(packMuleTier(50)).toBe("gold");
    expect(packMuleTier(500)).toBe("gold");
  });
});

describe("awardedBadges", () => {
  it("gives a brand-new member nothing", () => {
    expect(awardedBadges(NOBODY)).toEqual([]);
  });

  it("awards first_rental on the very first loan, before Pack Mule", () => {
    expect(keysOf({ gearLoans: 1 })).toEqual(["first_rental"]);
  });

  it("keeps first_rental alongside Pack Mule rather than replacing it", () => {
    // Tiers replace each other; separate badges do not. A member who
    // reaches 10 loans has still checked out their first.
    const awards = awardedBadges({ ...NOBODY, gearLoans: 10 });
    expect(awards.map((b) => b.key)).toEqual(["first_rental", "pack_mule"]);
    expect(awards.find((b) => b.key === "pack_mule")?.tier).toBe("bronze");
  });

  it("reports the count behind a tallied badge", () => {
    const awards = awardedBadges({
      ...NOBODY,
      completedSeasons: 3,
      gearLoans: 30,
    });
    expect(awards.find((b) => b.key === "hemlock")?.count).toBe(3);
    expect(awards.find((b) => b.key === "pack_mule")?.count).toBe(30);
    // A yes/no badge has no tally to show.
    expect(awards.find((b) => b.key === "first_rental")?.count).toBeNull();
  });

  it("needs a full ten-loan streak for clean_return", () => {
    expect(keysOf({ onTimeReturnStreak: 9 })).not.toContain("clean_return");
    expect(keysOf({ onTimeReturnStreak: 10 })).toContain("clean_return");
  });

  it("awards sweep_crew for a single sweep", () => {
    expect(keysOf({ sweepsParticipated: 1 })).toEqual(["sweep_crew"]);
  });

  it("awards the officer badge off the role flag alone", () => {
    expect(keysOf({ isOfficer: true })).toEqual(["officer"]);
  });

  it("never awards a badge whose data source does not exist yet", () => {
    // The guard is what lets the catalog list trip badges before trip
    // attendance exists. Without it, a future counter wired to the
    // wrong field would hand out "Underground" to everyone.
    const everything: BadgeInputs = {
      completedSeasons: 99,
      gearLoans: 99,
      onTimeReturnStreak: 99,
      sweepsParticipated: 99,
      isOfficer: true,
    };
    const blocked = BADGE_KEYS.filter((key) => !isBadgeLive(key));
    const awarded = awardedBadges(everything).map((b) => b.key);

    // Guard against the assertion going vacuous if every badge ever
    // becomes earnable: then this test should be deleted, not pass
    // silently.
    expect(blocked.length).toBeGreaterThan(0);
    expect(awarded.filter((key) => blocked.includes(key))).toEqual([]);
    expect(awarded).toContain("white_oak");
  });
});

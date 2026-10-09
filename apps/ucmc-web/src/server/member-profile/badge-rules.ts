/**
 * Turns a member's counters into the badges they hold.
 *
 * Pure and parameterised — every input, the clock included, arrives as
 * an argument. That is what lets Stryker mutate it (see
 * `stryker.config.json`): a threshold inlined into an action is not
 * mutation-testable, and an off-by-one in a threshold is exactly the
 * defect a surviving mutant would catch. Same shape as
 * `gear/lib/loan-reminders.ts`.
 *
 * Thresholds live here rather than in `badge-registry.ts` so a tier
 * can never drift from the number that earns it: the registry says
 * what a badge is called, this file says when you get it.
 *
 * Nothing persists an award. Badges are recomputed on every read of a
 * profile, so a revoked waiver or a corrected loan takes the badge
 * back the same instant it takes the data back.
 */

import type { AwardedBadge, BadgeKey, BadgeTier } from "./badge-registry";

/**
 * The counters a profile is scored on. Every field is a plain number
 * so the caller owns all the SQL and this file owns all the policy.
 */
export interface BadgeInputs {
  /**
   * Club years the member has **finished** — distinct non-revoked
   * attested cycles, excluding the one running now.
   *
   * Not "years since they registered": the club re-collects a waiver
   * every fall, so an attested cycle is the only evidence someone was
   * actually around that year. And not a count that includes the
   * current season, because a tenure badge marks a season completed —
   * the same thing the avatar's closed rings count, so the badge and
   * the rings can never tell a member two different numbers.
   */
  completedSeasons: number;
  /** Lifetime gear loans, returned or not. */
  gearLoans: number;
  /**
   * Consecutive most-recent returned loans that came back on or
   * before their due date. Streak, not a rate: a rate punishes a
   * member forever for one bad semester, and the badge is meant to
   * be winnable back.
   */
  onTimeReturnStreak: number;
  /** Inventory sweeps the member logged at least one item in. */
  sweepsParticipated: number;
  /** Holds, or has held, any role other than plain `member`. */
  isOfficer: boolean;
}

/** Completed seasons needed for each tenure badge, ascending. */
const TENURE_LADDER = [
  { seasons: 1, key: "redbud" },
  { seasons: 2, key: "pawpaw" },
  { seasons: 3, key: "hemlock" },
  { seasons: 4, key: "hickory" },
  { seasons: 5, key: "white_oak" },
] as const satisfies readonly { seasons: number; key: BadgeKey }[];

/** Loans needed for each Pack Mule tier, ascending. */
const PACK_MULE_TIERS = [
  { count: 10, tier: "bronze" },
  { count: 25, tier: "silver" },
  { count: 50, tier: "gold" },
] as const satisfies readonly { count: number; tier: BadgeTier }[];

const FIRST_RENTAL_LOANS = 1;
const CLEAN_RETURN_STREAK = 10;
const SWEEP_CREW_SWEEPS = 1;

/**
 * The highest tenure badge earned, or `null` during a first season.
 *
 * Only the top rung is returned. Showing all five at year five would
 * bury the one that means something under four that no longer do —
 * the ring count on the avatar already carries the history.
 */
export function tenureBadgeFor(completedSeasons: number): BadgeKey | null {
  let earned: BadgeKey | null = null;
  for (const rung of TENURE_LADDER) {
    if (completedSeasons >= rung.seasons) {
      earned = rung.key;
    }
  }
  return earned;
}

/**
 * Completed seasons still needed for the next tenure badge, or `null`
 * once the ladder is topped out. Drives the "one more season to
 * Hemlock" line under the rings — the arc shows progress through the
 * year, this says what the year is worth.
 */
export function nextTenureBadge(
  completedSeasons: number,
): { key: BadgeKey; seasonsAway: number } | null {
  for (const rung of TENURE_LADDER) {
    if (completedSeasons < rung.seasons) {
      return { key: rung.key, seasonsAway: rung.seasons - completedSeasons };
    }
  }
  return null;
}

/** Highest Pack Mule tier at this loan count, or `null` below bronze. */
export function packMuleTier(gearLoans: number): BadgeTier | null {
  let tier: BadgeTier | null = null;
  for (const rung of PACK_MULE_TIERS) {
    if (gearLoans >= rung.count) {
      tier = rung.tier;
    }
  }
  return tier;
}

/**
 * Every badge the member currently holds, in catalog order.
 *
 * **Only live badges may be awarded here.** A badge the registry
 * marks `blockedBy` has no data behind it yet and exists so the
 * catalog can show what is coming; awarding one would be handing out
 * a trip badge to someone who has never been on a trip.
 *
 * That rule is enforced by the test, not by a runtime guard. A guard
 * here could never fire — every rule below is hand-written against a
 * live badge — so it was unreachable code that merely looked careful,
 * and mutation testing duly reported it as such. The test runs this
 * function with every counter maxed and asserts nothing blocked comes
 * out, which fails the moment a rule is wired to a blocked badge.
 */
export function awardedBadges(inputs: BadgeInputs): AwardedBadge[] {
  const awards: AwardedBadge[] = [];

  const push = (
    key: BadgeKey,
    tier: BadgeTier | null,
    count: number | null,
  ) => {
    awards.push({ key, tier, count });
  };

  const tenure = tenureBadgeFor(inputs.completedSeasons);
  if (tenure) {
    push(tenure, null, inputs.completedSeasons);
  }

  if (inputs.gearLoans >= FIRST_RENTAL_LOANS) {
    push("first_rental", null, null);
  }

  const mule = packMuleTier(inputs.gearLoans);
  if (mule) {
    push("pack_mule", mule, inputs.gearLoans);
  }

  if (inputs.onTimeReturnStreak >= CLEAN_RETURN_STREAK) {
    push("clean_return", null, inputs.onTimeReturnStreak);
  }

  if (inputs.sweepsParticipated >= SWEEP_CREW_SWEEPS) {
    push("sweep_crew", null, inputs.sweepsParticipated);
  }

  if (inputs.isOfficer) {
    push("officer", null, null);
  }

  return awards;
}

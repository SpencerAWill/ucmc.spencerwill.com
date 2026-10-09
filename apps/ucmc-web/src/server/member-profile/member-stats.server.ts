/**
 * Loads the counters a member's profile is scored on, and scores them.
 *
 * Lives in `src/server/` rather than `features/members` because it
 * reads across three features' tables — waivers, gear, roles — and
 * features can't import each other. Same reasoning as
 * `gear-cave-standing.server.ts` and `current-attestation.server.ts`.
 *
 * The split is deliberate: every SQL question is answered here, every
 * policy question in `badge-rules.ts`. That keeps the thresholds in a
 * pure, mutation-testable module while the queries stay where the
 * `getDb()` call is.
 *
 * Nothing here is cached or stored. Badges are derived on each read,
 * so revoking a waiver or correcting a loan takes the badge back in
 * the same breath.
 */

import {
  and,
  countDistinct,
  desc,
  eq,
  isNotNull,
  isNull,
  min,
  sql,
} from "drizzle-orm";

import { getDb } from "#/server/db";
import * as schema from "../../../drizzle/schema";

import type { AwardedBadge } from "./badge-registry";
import type { BadgeInputs } from "./badge-rules";
import { awardedBadges } from "./badge-rules";
import { seasonComplete, seasonProgress } from "./season-progress";

export interface MemberCounters {
  /**
   * Club years finished: attested cycles whose May 1 has passed. This
   * is what the avatar's closed rings count, so a member in their
   * first season has none.
   */
  completedSeasons: number;
  /**
   * How far through their current season, in `[0, 1]`, or `null` when
   * they have no season running — a lapsed member, or anyone in the
   * May-to-August gap between seasons. Drawn as a partial arc outside
   * the closed rings.
   */
  seasonProgress: number | null;
  /** Lifetime gear loans, open and returned. */
  gearLoans: number;
  /** Currently open loans, i.e. gear the member is holding today. */
  openLoans: number;
  /** Consecutive most-recent returns that beat their due date. */
  onTimeReturnStreak: number;
  sweepsParticipated: number;
}

export interface MemberStats extends MemberCounters {
  badges: AwardedBadge[];
}

/**
 * How far back the on-time streak is counted.
 *
 * The streak only has to establish whether the member cleared the
 * Clean Return threshold, so there is no reason to drag a decade of
 * loan history across the wire to find out. Comfortably above the
 * threshold in `badge-rules.ts`; if that ever climbs past this, the
 * badge simply stops being awardable, which the test pins.
 */
export const STREAK_LOOKBACK = 60;

/**
 * Counts returns from newest backwards, stopping at the first late
 * one. Exported for the test — the SQL above it is what makes the
 * ordering real, and a streak computed over an unordered list is the
 * bug worth pinning.
 */
export function onTimeStreak(
  returns: readonly { returnedAt: Temporal.Instant; dueAt: Temporal.Instant }[],
): number {
  let streak = 0;
  for (const row of returns) {
    // `<=` not `<`: a loan returned on its due date is on time. Due
    // dates are stamped end-of-day in the club zone by `computeDueAt`,
    // so same-day equality is the common case, not an edge one.
    if (Temporal.Instant.compare(row.returnedAt, row.dueAt) > 0) {
      break;
    }
    streak += 1;
  }
  return streak;
}

/**
 * Counters only, so the caller can issue this alongside its other
 * per-member reads instead of waiting on them. Scoring is a separate,
 * synchronous step (`scoreMemberStats`) because the officer badge
 * needs the role rows the caller is already loading, and re-querying
 * them here would buy a second round trip to D1 for an answer the
 * caller is holding.
 */
export async function loadMemberCounters(
  userId: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<MemberCounters> {
  const db = getDb();

  const [cycleRows, loanRows, returnRows, sweepRows] = await Promise.all([
    // The distinct CYCLES, not a count: the current one has to be
    // told apart from the finished ones, and a club member has at
    // most a handful of rows here. A revoke-then-reattest leaves two
    // rows for one year, and that is still one season — hence
    // distinct.
    //
    // Deliberately NOT filtered on `version`: the current-waiver
    // guard cares which PDF was signed, but tenure is about whether
    // the member was around, and a `WAIVER_VERSION` bump must not
    // retroactively erase a year they were.
    db
      .select({
        cycle: schema.waiverAttestations.cycle,
        // The FIRST attestation for a cycle is when the member signed
        // on for that season, and that is where their arc starts. A
        // revoke-and-reattest later in the year must not reset the
        // arc to zero — they were a member the whole time.
        attestedAt: min(schema.waiverAttestations.attestedAt),
      })
      .from(schema.waiverAttestations)
      .where(
        and(
          eq(schema.waiverAttestations.userId, userId),
          isNull(schema.waiverAttestations.revokedAt),
        ),
      )
      .groupBy(schema.waiverAttestations.cycle),
    db
      .select({
        total: sql<number>`count(*)`,
        open: sql<number>`sum(case when ${schema.gearLoans.returnedAt} is null then 1 else 0 end)`,
      })
      .from(schema.gearLoans)
      .where(eq(schema.gearLoans.memberUserId, userId)),
    // Newest return first — `onTimeStreak` walks this order and stops
    // at the first late one, so the ORDER BY is part of the logic.
    db
      .select({
        returnedAt: schema.gearLoans.returnedAt,
        dueAt: schema.gearLoans.dueAt,
      })
      .from(schema.gearLoans)
      .where(
        and(
          eq(schema.gearLoans.memberUserId, userId),
          isNotNull(schema.gearLoans.returnedAt),
        ),
      )
      .orderBy(desc(schema.gearLoans.returnedAt))
      .limit(STREAK_LOOKBACK),
    db
      .select({
        value: countDistinct(schema.gearInventorySweepEntries.sweepId),
      })
      .from(schema.gearInventorySweepEntries)
      .where(eq(schema.gearInventorySweepEntries.seenByUserId, userId)),
  ]);

  // Partitioned on May 1, not on the August cycle rollover, so a ring
  // closes at the same instant its arc fills.
  const completedSeasons = cycleRows.filter((r) =>
    seasonComplete(r.cycle, now),
  ).length;
  // At most one cycle can be unfinished: the club cannot attest a
  // future year, so everything but the newest has a May 1 behind it.
  const running = cycleRows.find((r) => !seasonComplete(r.cycle, now));
  const progress =
    running && running.attestedAt
      ? seasonProgress(running.attestedAt, running.cycle, now)
      : null;
  const gearLoans = Number(loanRows[0]?.total ?? 0);
  // `sum()` over zero rows is NULL, not 0.
  const openLoans = Number(loanRows[0]?.open ?? 0);
  const sweepsParticipated = sweepRows[0]?.value ?? 0;

  const onTimeReturnStreak = onTimeStreak(
    returnRows.flatMap((row) =>
      // `returnedAt` is non-null by the WHERE above; the flatMap is
      // how that survives into the type without a non-null assertion.
      row.returnedAt ? [{ returnedAt: row.returnedAt, dueAt: row.dueAt }] : [],
    ),
  );

  return {
    completedSeasons,
    seasonProgress: progress,
    gearLoans,
    openLoans,
    onTimeReturnStreak,
    sweepsParticipated,
  };
}

/**
 * @param isOfficer holds, or has held, any role other than plain
 *   `member`.
 */
export function scoreMemberStats(
  counters: MemberCounters,
  isOfficer: boolean,
): MemberStats {
  const inputs: BadgeInputs = {
    completedSeasons: counters.completedSeasons,
    gearLoans: counters.gearLoans,
    onTimeReturnStreak: counters.onTimeReturnStreak,
    sweepsParticipated: counters.sweepsParticipated,
    isOfficer,
  };
  return { ...counters, badges: awardedBadges(inputs) };
}

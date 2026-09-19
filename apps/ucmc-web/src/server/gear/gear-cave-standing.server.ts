/**
 * Gear cave standing: what a member's overdue gear means for what they
 * are allowed to borrow next.
 *
 * Deliberately scoped to the cave rather than named "member standing" —
 * the club may well grow other standings (trips, dues, training) that
 * answer to different rules, and a single global "standing" would either
 * collapse them or have to be renamed later under more pressure.
 *
 * Lives in `src/server/` rather than `features/gear/` because three
 * callers need it and features can't import each other — the gear desk
 * blocks checkout on it, `/my/gear` shows the member their own banner,
 * and trips will want it when sign-ups land. Hoisting now is cheaper
 * than a third `FEATURE_PUBLIC_API` later.
 *
 * **Standing is derived, never stored.** It's a function of open loans
 * and two thresholds, both of which are site settings. Storing it would
 * mean a cron to keep it true and a way for it to disagree with the loan
 * table; computing it at read time can't drift.
 */
import { readSetting } from "#/server/settings/settings-repo.server";

export const GEAR_CAVE_STANDING = ["good", "flagged", "blocked"] as const;
export type GearCaveStanding = (typeof GEAR_CAVE_STANDING)[number];

export interface GearCaveStandingResult {
  standing: GearCaveStanding;
  /** Open loans past due, worst first. Empty when standing is `good`. */
  overdue: Array<{ publicId: string; dueAt: Temporal.Instant; days: number }>;
  /** Whole days overdue on the worst item; 0 when nothing is overdue. */
  worstDaysOverdue: number;
  /** Resolved thresholds, so a caller can explain the verdict without
   *  re-reading the settings. */
  flagAfterDays: number;
  blockAfterDays: number;
}

/**
 * Whole days between a due date and now, in `CLUB_TIME_ZONE`.
 *
 * Due dates are stamped at end-of-day Cincinnati time by `computeDueAt`,
 * so "one day overdue" has to mean "a whole club day has passed", not
 * "24 hours have elapsed since an instant". Reading calendar days off a
 * raw instant would also make the count differ between the worker (UTC)
 * and a member's browser.
 */
function daysOverdue(
  dueAt: Temporal.Instant,
  now: Temporal.Instant,
  timeZone: string,
): number {
  if (Temporal.Instant.compare(now, dueAt) <= 0) return 0;
  const due = dueAt.toZonedDateTimeISO(timeZone).toPlainDate();
  const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
  return due.until(today).days;
}

/**
 * Compute a member's cave standing.
 *
 * `now` is a parameter rather than read from the clock so tests can pin
 * it — the same reason `currentWaiverCycle` takes one.
 */
export async function gearCaveStanding(input: {
  memberUserId: string;
  now: Temporal.Instant;
  timeZone: string;
}): Promise<GearCaveStandingResult> {
  const [flagAfterDays, blockAfterDays] = await Promise.all([
    readSetting("gear.overdueFlagDays"),
    readSetting("gear.overdueBlockDays"),
  ]);
  const { listOverdueLoansForMember } =
    await import("#/features/gear/server/loans-repo.server");
  const rows = await listOverdueLoansForMember(input.memberUserId, input.now);
  const overdue = rows
    .map((r) => ({
      publicId: r.publicId,
      dueAt: r.dueAt,
      days: daysOverdue(r.dueAt, input.now, input.timeZone),
    }))
    .sort((a, b) => b.days - a.days);
  const worstDaysOverdue = overdue.at(0)?.days ?? 0;

  // A block threshold set below the flag threshold is a misconfiguration
  // rather than an error: honour whichever fires, so the stricter of the
  // two still governs and nobody silently escapes both.
  const standing: GearCaveStanding =
    worstDaysOverdue >= blockAfterDays
      ? "blocked"
      : worstDaysOverdue >= flagAfterDays
        ? "flagged"
        : "good";

  return {
    standing,
    overdue: standing === "good" ? [] : overdue,
    worstDaysOverdue,
    flagAfterDays,
    blockAfterDays,
  };
}

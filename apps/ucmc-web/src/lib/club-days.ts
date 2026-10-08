/**
 * Whole-calendar-day arithmetic in a named time zone.
 *
 * Extracted from `gear-cave-standing.server.ts`, which had it private,
 * because the loan reminder ladder has to agree with member standing to
 * the day: the ladder's "flagged" rung fires on `gear.overdueFlagDays`,
 * and an email saying "you are now flagged" that arrives a day before or
 * after the desk actually flags them is worse than no email.
 *
 * Lives in `src/lib/` rather than beside either caller because one of
 * them is server-only and the stage computation is pure — shared, pure
 * code can't sit behind a `.server.ts` boundary.
 *
 * **Calendar days, not elapsed time.** See `dates-and-formats.md`: due
 * dates are stamped at end-of-day Cincinnati time, so "one day overdue"
 * has to mean "a whole club day has turned", not "24 hours have passed".
 * Reading calendar fields off a raw instant would also make the count
 * differ between the worker (UTC) and a member's browser.
 */

/**
 * Whole calendar days from `from`'s local date to `to`'s local date.
 *
 * Negative when `to` falls on an earlier date than `from`. Both instants
 * are projected into `timeZone` first, so the answer is the number of
 * midnights crossed there — which is what a borrower means by "days".
 */
export function clubDayDifference(
  from: Temporal.Instant,
  to: Temporal.Instant,
  timeZone: string,
): number {
  const fromDate = from.toZonedDateTimeISO(timeZone).toPlainDate();
  const toDate = to.toZonedDateTimeISO(timeZone).toPlainDate();
  return fromDate.until(toDate).days;
}

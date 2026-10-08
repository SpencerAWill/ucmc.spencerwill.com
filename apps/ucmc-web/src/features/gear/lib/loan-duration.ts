import { CLUB_TIME_ZONE } from "#/config/time";

/**
 * Fallback loan duration, in days, for the window before the desk has
 * read `gear.defaultLoanDays` from the server.
 *
 * **The site setting is the policy; this is the prefill the sheet shows
 * while the query is in flight.** It was the policy until the setting
 * landed — leaving it a constant while the overdue thresholds beside it
 * were tunable was the inconsistency #224 called out, since a setting
 * needs no migration and a column does.
 *
 * The two numbers must agree, and `loan-duration.test.ts` pins that
 * against the registry so a later tidy-up of either can't make the
 * sheet flicker from one value to another on load.
 *
 * Still club-wide, not per-type. If officers ever want tents at 14 and
 * harnesses at 7, that is a `default_loan_days` column on `gear_types`
 * resolved at checkout — deliberately not built on speculation.
 */
export const DEFAULT_LOAN_DURATION_DAYS = 7;

export const MAX_LOAN_DURATION_DAYS = 90;

/**
 * Compute the due timestamp given a starting moment and a duration.
 *
 * Always snaps to the *end of the due day* (23:59:59.999 local time)
 * so "due" reads as a calendar event, not a specific clock time. Two
 * practical wins:
 *   - `durationDays = 0` (same-day checkout, used at exec-meeting
 *     loan-and-return scenarios) yields a due moment late today, not
 *     midnight-today which would be already-overdue.
 *   - A 7-day loan checked out at 9am Monday is due end-of-Monday a
 *     week later, not 9am — matches the borrower's mental model.
 */
export function computeDueAt(
  checkedOutAt: Temporal.Instant,
  durationDays: number,
): Temporal.Instant {
  // "End of the due day" is the end of the *Cincinnati* day (23:59:59.999
  // local), so the loan reads as a calendar event for the borrower rather
  // than flipping overdue at 23:59 UTC (~8pm local).
  return checkedOutAt
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .add({ days: durationDays })
    .with({
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
      microsecond: 999,
      nanosecond: 999,
    })
    .toInstant();
}

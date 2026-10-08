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
 * The loan length to prefill so the due date lands on a day the cave is
 * actually open.
 *
 * **A default, not a rule.** Nothing on the server applies this: the desk
 * uses it to pick what the date control starts on, and whatever the
 * officer submits is what gets stored. `computeDueAt` is untouched, so
 * extensions, the bulk importer and every historical row keep the dates
 * they were given. Off-cycle checkouts and returns stay entirely possible
 * — this only changes what the sheet suggests.
 *
 * The cave is open about two hours a week (#242). A Wednesday checkout
 * with the 7-day default already lands on a Wednesday, which is where the
 * club's rhythm comes from; every *other* weekday produced a due date on a
 * day the cave is shut, so the member went overdue Wednesday morning and
 * the first moment they could return was that evening. The reminder ladder
 * is what made it audible — an overdue email nobody can act on.
 *
 * Rolls **forward only**, so the member keeps the full loan they were
 * promised plus the wait for a door to be open — a Tuesday checkout
 * becomes 8 days, never 6.
 *
 * Three cases deliberately pass straight through:
 *   - `durationDays <= 0` — the exec-meeting loan-and-return, out and back
 *     the same evening. Rolling that forward would push it a week.
 *   - No open days configured — the summer, when there are no cave hours
 *     at all and `gear.caveHoursNote` goes blank beside it.
 *   - A roll that would breach `MAX_LOAN_DURATION_DAYS`. Checkout clamps
 *     to the ceiling, so returning the longer value would just be clamped
 *     back onto a shut day; the un-rolled default is the honest answer.
 */
export function defaultLoanDurationDays(
  from: Temporal.PlainDate,
  durationDays: number,
  caveOpenWeekdays: readonly number[],
): number {
  if (durationDays <= 0 || caveOpenWeekdays.length === 0) {
    return durationDays;
  }
  // At most six steps: any non-empty subset of the week contains an open
  // day within a week of any starting point.
  for (let offset = 0; offset < 7; offset += 1) {
    const total = durationDays + offset;
    if (total > MAX_LOAN_DURATION_DAYS) {
      return durationDays;
    }
    if (caveOpenWeekdays.includes(from.add({ days: total }).dayOfWeek)) {
      return total;
    }
  }
  return durationDays;
}

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

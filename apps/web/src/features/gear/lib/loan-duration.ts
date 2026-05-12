/**
 * Default loan duration for a new gear checkout, in days. The officer
 * may override per-row in the gear-desk checkout pane; this is the
 * baked-in default the UI prefills.
 *
 * Exported as a single constant (not per-type) so the policy is easy
 * to find and adjust club-wide. If we ever want per-type defaults
 * (e.g. tents lend for 14, harnesses for 7), add a `defaultLoanDays`
 * column to `gear_types` and resolve at checkout time.
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
export function computeDueAt(checkedOutAt: Date, durationDays: number): Date {
  const due = new Date(checkedOutAt);
  due.setDate(due.getDate() + durationDays);
  due.setHours(23, 59, 59, 999);
  return due;
}

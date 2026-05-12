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

/** Compute the due timestamp given a starting moment and a duration. */
export function computeDueAt(checkedOutAt: Date, durationDays: number): Date {
  const due = new Date(checkedOutAt);
  due.setDate(due.getDate() + durationDays);
  return due;
}

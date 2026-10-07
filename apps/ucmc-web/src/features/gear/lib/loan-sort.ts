/**
 * The loans list's sort contract, shared by the repo that applies it,
 * the route that puts it in the URL, and the toolbar that offers it.
 *
 * It lives in `lib/` rather than beside `listLoans` because all three
 * need it and two of them are client code — the same reason
 * `loan-duration.ts` sits here and not in the action that calls it.
 */

export const LOAN_SORT_KEYS = ["due_at", "checked_out_at"] as const;
export type LoanSortKey = (typeof LOAN_SORT_KEYS)[number];

export const LOAN_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type LoanSortDirection = (typeof LOAN_SORT_DIRECTIONS)[number];

/**
 * The direction a sort key lands on when nobody names one.
 *
 * Both values reproduce the behaviour from before direction was
 * selectable, when each key had exactly one hardcoded order: due date
 * ascending is "most overdue first", checked-out descending is "most
 * recent first". Those are the questions an officer arrives with, so
 * they stay the defaults rather than a uniform `asc`.
 *
 * The route also reads this to decide when to *omit* `dir` from the
 * URL, so a shared link carries only what the sender actually changed.
 */
export const DEFAULT_LOAN_SORT_DIRECTION: Record<
  LoanSortKey,
  LoanSortDirection
> = {
  due_at: "asc",
  checked_out_at: "desc",
};

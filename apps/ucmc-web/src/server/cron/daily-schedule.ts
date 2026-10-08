/**
 * Which cron expressions reach the daily branch of the worker's
 * `scheduled` handler.
 *
 * ## The hour, and the drift we accept
 *
 * `0 12 * * *` is **08:00 EDT / 07:00 EST** in Cincinnati. Cloudflare
 * cron triggers are UTC-only with no DST awareness, so no single
 * expression holds a fixed local hour — it drifts by one across the
 * year, and 12:00 is the best a single one can do for a club whose
 * semesters straddle both halves.
 *
 * The hour is chosen for the **emails**, not the retention sweeps. It
 * was 08:00 UTC when only the sweeps rode this tick — 03:00/04:00
 * local, which is fine for DB deletes nobody sees and wrong for mail
 * that can buzz a member's phone overnight.
 *
 * ## Why not pin it to 08:00 year-round
 *
 * It is possible: register both `0 12 * * *` and `0 13 * * *`, then
 * discard whichever tick isn't 08:00 local. **It was built that way and
 * then reverted, so don't re-derive it without checking the budget.**
 *
 * `wrangler.jsonc` declares crons for two workers — `ucmc-web-dev` and
 * `ucmc-web-prod` — so every expression added here costs **two** against
 * the account. The Workers Free plan allows 5 cron triggers per account
 * and we are at 4 (two daily, two annual); a third expression would take
 * that to 6 and over the cap. On Workers Paid (250) the limit is not a
 * concern and the two-expression version is strictly better.
 *
 * ## Precision
 *
 * Cloudflare documents **no** timing guarantee for cron triggers — not
 * a tolerance, not a best effort. Community reports put it at
 * within-the-minute. Nothing here depends on better than hour-level
 * accuracy, and both daily jobs are idempotent: retention re-sweeps
 * whatever is still expired, and the reminder ladder is explicitly
 * built to catch a missed day at the right rung rather than skip it.
 */

/**
 * Must stay in sync with `triggers.crons` in `wrangler.jsonc` (both the
 * top-level block and the `production` env) and with the dispatcher in
 * `server-entry.ts`.
 */
export const DAILY_CRON_EXPRESSIONS = ["0 12 * * *"] as const;

export function isDailyCron(expression: string): boolean {
  return (DAILY_CRON_EXPRESSIONS as readonly string[]).includes(expression);
}

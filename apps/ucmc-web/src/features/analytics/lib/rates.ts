/**
 * Shares and rates that have to refuse to answer rather than guess.
 *
 * Pure and client-safe, so routes can import them — the identical
 * helpers inside a `*-actions.server.ts` would drag server-only code
 * into the client graph — and so Stryker can mutate them.
 *
 * The common thread is the **zero denominator**. Every one of these
 * returns `null` rather than 0 when there is nothing to divide by,
 * because at this club's N "no data" and "zero" are routinely
 * confused, and 0% reads as an achievement the club did not earn.
 */

/**
 * Cancelled as a share of scheduled, or null when nothing was
 * scheduled.
 *
 * Not `canceled / held`: the denominator is everything that went on
 * the calendar, which is what "we cancel a quarter of what we plan"
 * actually means.
 */
export function cancellationRate(
  held: number,
  canceled: number,
): number | null {
  const scheduled = held + canceled;
  return scheduled === 0 ? null : canceled / scheduled;
}

/** A share of a whole, or null when the whole is zero. */
export function shareOf(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** `0.237` to `"24%"`, and a null share to an em dash. */
export function formatShare(share: number | null): string {
  return share === null ? "\u2014" : `${Math.round(share * 100)}%`;
}

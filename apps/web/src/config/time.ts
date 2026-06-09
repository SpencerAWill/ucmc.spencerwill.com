/**
 * The club's civil time zone.
 *
 * Cloudflare Workers run in UTC, but UCMC's calendar-shaped rules are
 * Cincinnati-local: the waiver cycle rolls over at midnight *local* on
 * Aug 21, gear loans are due at the end of the *local* day, the officer
 * archive fires on March 1 *local*, and the Gazette publish date is a
 * local calendar date. Computing those in UTC drifts the boundary by the
 * UTC offset (4–5h), so every calendar-reasoning site converts an
 * `Temporal.Instant` to this zone first — never UTC, never the runtime
 * default.
 *
 * Pure timestamp display (relative times, audit rows) intentionally does
 * NOT use this — those render in the viewer's local zone.
 */
export const CLUB_TIME_ZONE = "America/New_York";

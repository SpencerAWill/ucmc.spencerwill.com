import { CLUB_TIME_ZONE } from "#/config/time";

/**
 * The instant at which "today" began in Cincinnati.
 *
 * This is the cut between /volunteer's two bands. `volunteer_events`
 * carries no status column — "Coming up" is `starts_at >= dayStart` and
 * "Our record" is `starts_at < dayStart` — so this one function decides
 * which band every row lands in, and the two can never disagree.
 *
 * The bound is the start of the *day*, not `now`, on purpose: a trail
 * day that began at 09:00 shouldn't drop out of "Coming up" at noon
 * while people are still driving to it. It's the mirror of
 * `computeDueAt`'s end-of-day snap in the gear feature — the club's
 * calendar-shaped rules are all Cincinnati-local, and the worker runs
 * in UTC, so the instant is converted to {@link CLUB_TIME_ZONE} before
 * any month/day reasoning.
 *
 * `now` is a parameter rather than a `Temporal.Now` call inside so
 * tests can pin it either side of midnight.
 */
export function startOfClubDay(now: Temporal.Instant): Temporal.Instant {
  return now.toZonedDateTimeISO(CLUB_TIME_ZONE).startOfDay().toInstant();
}

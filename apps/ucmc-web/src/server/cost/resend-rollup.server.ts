/**
 * Rolls the raw email send log up into daily snapshot rows.
 *
 * Resend publishes no usage history, so this is the only record of how
 * much mail the club sends over time. `email_sends` is swept after 90
 * days; these rows are kept forever, so the rollup is what a season
 * report actually reads.
 *
 * Days are bucketed in `CLUB_TIME_ZONE`, not UTC. The worker runs UTC,
 * so a send at 21:00 Cincinnati time is already "tomorrow" in UTC and
 * would land in the wrong day's bucket — which matters most for the
 * evening reminder mail this feature exists to count.
 */
import { and, asc, gte, lt } from "drizzle-orm";

import { CLUB_TIME_ZONE } from "#/config/time";
import type { SnapshotRow } from "#/server/cost/snapshot-row";
import { getDb, schema } from "#/server/db";

/** Civil date in the club zone for an instant. */
function clubDate(instant: Temporal.Instant): string {
  return instant.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString();
}

/** Midnight club-local on a civil date, as an instant. */
function startOfClubDay(date: string): Temporal.Instant {
  return Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone: CLUB_TIME_ZONE })
    .toInstant();
}

/**
 * One `resend.sends` row per day in `[from, to]`, counting every send
 * attempt logged that day.
 *
 * **Days with no mail get an explicit zero row — but only from the day
 * logging began.** A missing row and a zero mean different things: "we
 * were not measuring" versus "we sent nothing". A chart that skips a
 * quiet day draws a continuous line through a gap it should show, and a
 * zero written for a day before `email_sends` existed claims a
 * measurement that was never taken. A backfill reaches months further
 * back than the log does, so this is the normal case, not an edge one.
 */
export async function rollUpResendSends(args: {
  from: string;
  to: string;
}): Promise<SnapshotRow[]> {
  const windowStart = startOfClubDay(args.from);
  // Exclusive upper bound: midnight at the start of the day AFTER `to`,
  // so `to` itself is fully included.
  const windowEnd = startOfClubDay(
    Temporal.PlainDate.from(args.to).add({ days: 1 }).toString(),
  );

  const sends = await getDb()
    .select({ sentAt: schema.emailSends.sentAt })
    .from(schema.emailSends)
    .where(
      and(
        gte(schema.emailSends.sentAt, windowStart),
        lt(schema.emailSends.sentAt, windowEnd),
      ),
    );

  const counts = new Map<string, number>();
  for (const send of sends) {
    const day = clubDate(send.sentAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  // The first send ever logged is the day this table started being able
  // to answer the question. Anything earlier gets no row at all.
  const loggingBegan = await earliestLoggedSendDate();
  if (loggingBegan === null) {
    return [];
  }
  const windowFrom = args.from > loggingBegan ? args.from : loggingBegan;
  if (windowFrom > args.to) {
    return [];
  }

  const first = Temporal.PlainDate.from(windowFrom);
  const dayCount = first.until(Temporal.PlainDate.from(args.to)).days + 1;

  return Array.from({ length: Math.max(0, dayCount) }, (_, offset) => {
    const day = first.add({ days: offset });
    const date = day.toString();
    return {
      source: "resend",
      serviceFamily: null,
      serviceName: "resend.sends",
      periodStart: date,
      periodEnd: day.add({ days: 1 }).toString(),
      quantity: counts.get(date) ?? 0,
      unit: "emails",
      // Resend's free tier is the only plan in play and bills nothing.
      // Null rather than 0 so "not measured" never totals as "free".
      costCents: null,
      currency: null,
    };
  });
}

/**
 * Club-local date of the earliest send ever logged, or null when the
 * log is empty.
 *
 * Read separately from the window query rather than inferred from it:
 * a window containing no sends tells us nothing about whether logging
 * was running then, which is exactly the distinction this preserves.
 */
async function earliestLoggedSendDate(): Promise<string | null> {
  const rows = await getDb()
    .select({ sentAt: schema.emailSends.sentAt })
    .from(schema.emailSends)
    .orderBy(asc(schema.emailSends.sentAt))
    .limit(1);
  return rows.length > 0 ? clubDate(rows[0].sentAt) : null;
}

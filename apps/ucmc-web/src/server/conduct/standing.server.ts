/**
 * The only place the app decides whether a member is suspended or
 * terminated.
 *
 * Only `suspension` and `termination` records bear on standing. A
 * warning or note never does, and a record with `lifted_at` set is over
 * regardless of its dates. A termination has no end date, so it holds
 * until it is lifted. A suspension is active from `starts_on` through
 * `ends_on`, both inclusive.
 *
 * This lives in `src/server/` rather than `features/conduct/` because
 * `features/auth` (sign-in and the route guards), `features/members` and
 * `features/trips` all need the answer, and `import/no-restricted-paths`
 * forbids features importing each other. Hand-rolling the check per
 * feature is how the copies drift apart.
 *
 * "Today" is the Cincinnati-local calendar date, never the UTC date: the
 * Worker runs in UTC, so a suspension ending on the 10th would otherwise
 * lapse at 7pm EST on the 10th. Dates are `YYYY-MM-DD` text columns, so
 * they compare correctly as strings.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { CLUB_TIME_ZONE } from "#/config/time";
import { getDb, schema } from "#/server/db";

export interface ConductStanding {
  terminated: boolean;
  /** Latest end date among active suspensions, or null when none apply. */
  suspendedUntil: Temporal.PlainDate | null;
  /** Ids of the active suspension and termination records. */
  activeRecordIds: string[];
}

export async function standingFor(
  userId: string,
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(CLUB_TIME_ZONE),
): Promise<ConductStanding> {
  const day = today.toString();
  const rows = await getDb()
    .select({
      id: schema.conductRecords.id,
      level: schema.conductRecords.level,
      endsOn: schema.conductRecords.endsOn,
    })
    .from(schema.conductRecords)
    .where(
      and(
        eq(schema.conductRecords.subjectUserId, userId),
        isNull(schema.conductRecords.liftedAt),
        or(
          eq(schema.conductRecords.level, "termination"),
          and(
            eq(schema.conductRecords.level, "suspension"),
            sql`${schema.conductRecords.startsOn} <= ${day}`,
            sql`${schema.conductRecords.endsOn} >= ${day}`,
          ),
        ),
      ),
    );

  let suspendedUntil: Temporal.PlainDate | null = null;
  for (const row of rows) {
    if (
      row.level === "suspension" &&
      row.endsOn !== null &&
      (suspendedUntil === null ||
        Temporal.PlainDate.compare(row.endsOn, suspendedUntil) > 0)
    ) {
      suspendedUntil = row.endsOn;
    }
  }
  return {
    terminated: rows.some((r) => r.level === "termination"),
    suspendedUntil,
    activeRecordIds: rows.map((r) => r.id),
  };
}

export async function isTerminated(userId: string): Promise<boolean> {
  return (await standingFor(userId)).terminated;
}

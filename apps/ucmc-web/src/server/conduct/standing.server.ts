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
import { normalizeEmail } from "#/server/auth/email-normalize";
import { emailFingerprint } from "#/server/conduct/email-fingerprint.server";
import { getDb, inJsonArray, schema } from "#/server/db";

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

  const suspendedUntil = rows.reduce<Temporal.PlainDate | null>(
    (latest, row) =>
      row.level === "suspension" &&
      row.endsOn !== null &&
      (latest === null || Temporal.PlainDate.compare(row.endsOn, latest) > 0)
        ? row.endsOn
        : latest,
    null,
  );
  return {
    terminated: rows.some((r) => r.level === "termination"),
    suspendedUntil,
    activeRecordIds: rows.map((r) => r.id),
  };
}

export async function isTerminated(userId: string): Promise<boolean> {
  return (await standingFor(userId)).terminated;
}

/**
 * Whether any of these accounts is under an unlifted termination. One
 * query for the whole list (`inJsonArray`), for bulk callers such as
 * reactivation.
 */
export async function anyTerminated(userIds: string[]): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.conductRecords.id })
    .from(schema.conductRecords)
    .where(
      and(
        inJsonArray(schema.conductRecords.subjectUserId, userIds),
        eq(schema.conductRecords.level, "termination"),
        isNull(schema.conductRecords.liftedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether an address belongs to a member under an unlifted termination.
 * It matches on the keyed fingerprint written when the termination was
 * issued, so it holds after the account is purged and after the member
 * removes the address, and stops the moment the termination is lifted
 * (the lift also deletes the rows; the `lifted_at` test is the backstop).
 */
export async function isBlockedEmail(email: string): Promise<boolean> {
  const emailHmac = await emailFingerprint(email);
  const rows = await getDb()
    .select({ recordId: schema.conductBlockedEmails.recordId })
    .from(schema.conductBlockedEmails)
    .innerJoin(
      schema.conductRecords,
      eq(schema.conductRecords.id, schema.conductBlockedEmails.recordId),
    )
    .where(
      and(
        eq(schema.conductBlockedEmails.emailHmac, emailHmac),
        eq(schema.conductRecords.level, "termination"),
        isNull(schema.conductRecords.liftedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The subset of `emails` that `isBlockedEmail` would refuse, as the
 * normalized addresses, in one query (one JSON parameter however many
 * there are). For bulk entry such as an officer's pre-add list.
 */
export async function blockedEmailsAmong(
  emails: readonly string[],
): Promise<Set<string>> {
  if (emails.length === 0) {
    return new Set();
  }
  const byHmac = new Map<string, string>();
  for (const email of emails) {
    byHmac.set(await emailFingerprint(email), normalizeEmail(email));
  }
  const rows = await getDb()
    .selectDistinct({ emailHmac: schema.conductBlockedEmails.emailHmac })
    .from(schema.conductBlockedEmails)
    .innerJoin(
      schema.conductRecords,
      eq(schema.conductRecords.id, schema.conductBlockedEmails.recordId),
    )
    .where(
      and(
        inJsonArray(schema.conductBlockedEmails.emailHmac, [...byHmac.keys()]),
        eq(schema.conductRecords.level, "termination"),
        isNull(schema.conductRecords.liftedAt),
      ),
    );
  return new Set(rows.map((r) => byHmac.get(r.emailHmac)!));
}

/**
 * Unlifted terminations whose subject's name snapshot equals any of
 * `names`, ignoring case and surrounding whitespace. A hint for the
 * pending-registration queue, never a gate (`anyTerminated` is). The map
 * is keyed by the name as passed in and holds record public ids; names
 * with no match are absent. One query however many names there are.
 * `exceptSubjectUserId` drops records about that user (the viewer), so a
 * conduct viewer is never shown a record about themselves.
 */
export async function possibleTerminatedNameMatches(
  names: string[],
  exceptSubjectUserId?: string,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const byNormal = new Map<string, string[]>();
  for (const name of names) {
    const normal = name.trim().toLowerCase();
    if (normal === "") {
      continue;
    }
    byNormal.set(normal, [...(byNormal.get(normal) ?? []), name]);
  }
  if (byNormal.size === 0) {
    return result;
  }
  const snapshot = sql<string>`lower(trim(${schema.conductRecords.subjectNameSnapshot}))`;
  const rows = await getDb()
    .select({
      publicId: schema.conductRecords.publicId,
      normal: snapshot,
    })
    .from(schema.conductRecords)
    .where(
      and(
        inJsonArray(snapshot, [...byNormal.keys()]),
        eq(schema.conductRecords.level, "termination"),
        isNull(schema.conductRecords.liftedAt),
        exceptSubjectUserId === undefined
          ? undefined
          : sql`(${schema.conductRecords.subjectUserId} is null or ${schema.conductRecords.subjectUserId} <> ${exceptSubjectUserId})`,
      ),
    );
  for (const row of rows) {
    for (const name of byNormal.get(row.normal) ?? []) {
      result.set(name, [...(result.get(name) ?? []), row.publicId]);
    }
  }
  return result;
}

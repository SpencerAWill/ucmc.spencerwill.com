/**
 * D1 factories for conduct records.
 *
 * Workers pool only: these write to D1 through `getDb()`, and the
 * fingerprints need `CONDUCT_EMAIL_KEY`, which `vitest.workers.config.ts`
 * sets. The caller's `beforeEach` cleans `conduct_blocked_emails` and
 * `conduct_records` (storage isolation is per file).
 */
import { emailFingerprint } from "#/server/conduct/email-fingerprint.server";
import { getDb, schema } from "#/server/db";

/**
 * An unlifted termination that passed its vote, blocking `emails` the way
 * `createConductRecordAction` does. `subjectUserId` defaults to null: the
 * subject's row purged, which is the case the block exists for.
 * Returns the record id.
 */
export async function createTermination(
  args: {
    emails?: string[];
    subjectUserId?: string | null;
    subjectName?: string;
    liftedAt?: Temporal.Instant;
  } = {},
): Promise<string> {
  const recordId = `crec_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.conductRecords)
    .values({
      id: recordId,
      publicId: recordId,
      level: "termination",
      subjectUserId: args.subjectUserId ?? null,
      subjectNameSnapshot: args.subjectName ?? "Removed Member",
      liftedAt: args.liftedAt ?? null,
      memberStatement: "Statement",
      voteHeldOn: Temporal.PlainDate.from("2026-10-01"),
      votesFor: 5,
      votesAgainst: 1,
      votesAbstain: 0,
      committeeSize: 7,
      warningSkipped: true,
    });
  for (const email of args.emails ?? []) {
    await getDb()
      .insert(schema.conductBlockedEmails)
      .values({ recordId, emailHmac: await emailFingerprint(email) });
  }
  return recordId;
}

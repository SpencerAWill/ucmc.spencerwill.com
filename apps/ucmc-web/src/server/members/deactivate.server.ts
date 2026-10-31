/**
 * Deactivate accounts: the one implementation behind the members bulk
 * action and a conduct termination. It lives in `src/server/` because
 * `features/members` and `features/conduct` both need it and features may
 * not import each other.
 *
 * Only accounts that are currently `approved` transition; anyone else in
 * the list (pending, already deactivated, gone) is left alone and gets no
 * audit row. The callers' guards (who may deactivate, and not yourself)
 * stay with the callers.
 */
import { and, eq } from "drizzle-orm";

import { recordAuditEvents } from "#/server/audit/audit-log.server";
import { getDb, inJsonArray, schema } from "#/server/db";

/** Returns the ids that actually moved from approved to deactivated. */
export async function deactivateUserStatements(
  actorUserId: string,
  userIds: string[],
): Promise<string[]> {
  const db = getDb();

  // `.returning` gives the IDs of rows the UPDATE actually touched so the
  // audit log doesn't claim a deactivation for users in the wrong status.
  const updated = await db
    .update(schema.users)
    .set({ status: "deactivated", deactivatedAt: Temporal.Now.instant() })
    .where(
      and(
        inJsonArray(schema.users.id, userIds),
        eq(schema.users.status, "approved"),
      ),
    )
    .returning({ id: schema.users.id });

  // Immediately revoke all sessions so deactivated users are signed
  // out. Limit to the IDs that actually transitioned — purging
  // sessions for users we didn't touch would be a surprise side
  // effect of the bulk endpoint.
  const updatedIds = updated.map(({ id }) => id);
  if (updatedIds.length > 0) {
    await db
      .delete(schema.sessions)
      .where(inJsonArray(schema.sessions.userId, updatedIds));
  }

  // Sequential audit — see `audit-log.server.ts` residual case.
  await recordAuditEvents(
    updatedIds.map((userId) => ({
      actorUserId,
      action: "member.deactivated",
      targetUserId: userId,
    })),
  );

  return updatedIds;
}

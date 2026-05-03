/**
 * Append-only audit log writes. Called from every officer / admin
 * action whose effect we want to be reconstructable after the fact —
 * registration approvals, role changes, waiver attestations, landing
 * edits, hard deletes.
 *
 * **Strict, not best-effort.** A failed audit insert throws and
 * propagates back to the caller, which means the parent action fails
 * too. That's deliberate: silently dropping audit events would defeat
 * the constitutional CSA paper-trail purpose of the table. Better to
 * surface a transient D1 error to the officer (who can retry) than to
 * lose the record.
 *
 * **PII discipline.** `metadata` is for non-PII context only — role
 * names, status transitions, decision text, counts. Never email,
 * phone, full name, or anything reversible to a specific person; that
 * comes from the FK relationships if the row still exists.
 *
 * **One exception:** `member.self_deleted` cascade-NULLs both
 * `actorUserId` and `targetUserId` immediately on the user-row
 * delete, leaving the audit row with no attribution at all. For that
 * event specifically, capture `email` (and the original `userId` as
 * a text value) in `metadata` so the row stays meaningful — that's
 * the whole point of preserving an audit trail across deletions. No
 * other event type follows this pattern; if you find yourself adding
 * one, the audit story for that flow is probably wrong.
 *
 * The schema doc-comment in `drizzle/schema.ts` is the canonical
 * statement of this rule.
 */
import { uuidv7 } from "uuidv7";

import { getDb, schema } from "#/server/db";

export type AuditAction = schema.AuditAction;

export interface AuditEventInput {
  /** The officer / admin performing the action. NULL only for
   *  system-initiated events (none today; reserved for future cron
   *  actions that mutate state). */
  actorUserId: string | null;
  action: AuditAction;
  /** The user the action targets. Use this for any user-targeted
   *  event so the audit page can join across users + actions. */
  targetUserId?: string | null;
  /** For non-user targets — role IDs, landing setting keys,
   *  announcement IDs. Pair with `targetId`. */
  targetType?: string | null;
  targetId?: string | null;
  /** Non-PII context. Will be JSON-serialized. See module-level
   *  doc-comment for what's allowed. */
  metadata?: Record<string, unknown>;
}

function buildRow(event: AuditEventInput) {
  return {
    id: `audit_${uuidv7()}`,
    actorUserId: event.actorUserId,
    action: event.action,
    targetUserId: event.targetUserId ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
  };
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  await getDb().insert(schema.auditLog).values(buildRow(event));
}

/**
 * Bulk variant for actions that touch multiple targets in one call
 * (approve N members, attest a stack of paper waivers, etc.). One
 * audit row per target so the per-user view stays granular. Empty
 * input is a no-op.
 */
export async function recordAuditEvents(
  events: AuditEventInput[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await getDb().insert(schema.auditLog).values(events.map(buildRow));
}

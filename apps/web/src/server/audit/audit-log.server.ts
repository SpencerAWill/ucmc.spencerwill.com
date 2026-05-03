/**
 * Append-only audit log writes. Called from officer / admin actions
 * whose effect we want to be reconstructable after the fact — the
 * lifecycle state transitions on `users`, RBAC mutations, waiver
 * attestations, landing-page CRUD, member self-delete, and
 * officer-initiated session revocation. The `auditAction` enum in
 * `drizzle/schema.ts` is the canonical list.
 *
 * **What's deliberately NOT audited.** Cosmetic/no-effect mutations
 * are skipped to keep the log signal-to-noise high: role description
 * edits (`updateRoleAction`), and reorder operations across roles,
 * hero slides, FAQ items, and activities. These don't change *what*
 * the system says or does, only the order it presents things in.
 * Reconstructing intent from order changes would also require a
 * before/after diff that we don't capture today.
 *
 * **Strict, not best-effort.** A failed audit insert throws and
 * propagates back to the caller, which means the parent action fails
 * too. That's deliberate: silently dropping audit events would defeat
 * the constitutional CSA paper-trail purpose of the table. Better to
 * surface a transient D1 error to the officer (who can retry) than to
 * lose the record.
 *
 * **Atomic vs sequential.** This module exposes two flavors:
 *
 *   - `buildAuditEventStatement` / `buildBulkAuditEventStatement`
 *     return the prepared INSERT(s) so callers can spread them into
 *     a `db.batch([...])` together with the parent mutation. That's
 *     the **preferred path** — D1 batches are atomic at the storage
 *     layer, so the parent and audit either both commit or both
 *     roll back. Use this whenever the audit row(s) can be
 *     determined upfront from the action's input, which today
 *     covers create / delete / attest / role flows.
 *
 *   - `recordAuditEvent` / `recordAuditEvents` execute the audit
 *     INSERT in a separate await. They're the **escape hatch** for
 *     two cases:
 *       1. Bulk lifecycle actions that use `.returning({id})` to
 *          audit only the rows that actually transitioned —
 *          batching would either lose the filter (phantom audit
 *          rows) or require a pre-SELECT that introduces its own
 *          race (auditing rows that no longer match by the time
 *          the UPDATE runs).
 *       2. `member.self_deleted`, where the audit row has to be
 *          written AFTER the destructive work succeeds (so a failed
 *          delete doesn't leave a phantom row); the user is already
 *          gone by the time we audit, so atomicity has nothing left
 *          to attach to.
 *     Each call site that uses these is annotated with the reason.
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

/**
 * Returns the prepared INSERT statement for one audit event. Spread
 * into the caller's `db.batch([...])` for atomicity with the parent
 * mutation. Don't `await` this directly — that would defeat the
 * purpose; if you need a standalone insert, use `recordAuditEvent`.
 */
export function buildAuditEventStatement(event: AuditEventInput) {
  return getDb().insert(schema.auditLog).values(buildRow(event));
}

/**
 * Returns a single multi-row INSERT statement for many audit events,
 * or `null` when the input is empty (drizzle's batch can't handle a
 * zero-row insert). Same usage pattern as `buildAuditEventStatement`.
 *
 * Returns `null` rather than throwing on empty input because callers
 * commonly compute the events from a `.returning()` result that may
 * legitimately be empty (e.g. a bulk update that matched no rows).
 */
export function buildBulkAuditEventStatement(
  events: AuditEventInput[],
): ReturnType<typeof buildAuditEventStatement> | null {
  if (events.length === 0) {
    return null;
  }
  return getDb().insert(schema.auditLog).values(events.map(buildRow));
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  await buildAuditEventStatement(event);
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
  const stmt = buildBulkAuditEventStatement(events);
  if (stmt) {
    await stmt;
  }
}

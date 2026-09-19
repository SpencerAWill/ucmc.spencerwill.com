/**
 * Bulk-mutation actions driven by the gear-list toolbar's multi-select.
 * Each action takes an array of gear publicIds, resolves them to
 * internal ids, runs a single UPDATE / INSERT against D1, and emits
 * one audit row per affected piece.
 *
 * Unknown / mismatched publicIds (already retired when the action
 * expected active, doesn't resolve, etc.) are silently skipped — the
 * action's return tells the caller how many landed so the UI can
 * surface a "Retired 3 of 4 selected (1 was already retired)" toast
 * if it wants.
 */
import { requireGearManager } from "#/features/gear/server/permissions.server";
import {
  bulkAddGearItemTags,
  bulkMarkGearItemsReactivated,
  bulkSetGearItemCondition,
  buildBulkDeactivateStatement,
  getGearItemsByPublicIds,
  getGearTagsByPublicIds,
} from "#/features/gear/server/repo.server";
import {
  buildBulkAuditEventStatement,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";
import { getDb } from "#/server/db";
import type { schema } from "#/server/db";

export interface BulkResult {
  /** Count of gear rows that the underlying mutation touched. */
  affected: number;
  /** Count of supplied publicIds that didn't apply (didn't resolve,
   *  already in the target state, etc.). */
  skipped: number;
}

export async function bulkDeactivateGearAction(input: {
  publicIds: string[];
  status: Exclude<schema.GearStatus, "active">;
  reason: string | null;
}): Promise<BulkResult> {
  const principal = await requireGearManager();
  const rows = await getGearItemsByPublicIds(input.publicIds);
  // Only items currently active are eligible. Already-retired rows are
  // a no-op (the bulk SQL also filters this; we filter client-side to
  // get accurate `affected`/`skipped` counts AND to know which codes
  // to capture in the audit metadata).
  const active = rows.filter((r) => r.status === "active");
  // Also block anything on an open loan — deactivating would drop it
  // out of the borrower's "what do I have out" view mid-loan. Matches
  // the single-row action's `on_loan` short-circuit.
  const { getOpenLoansForItemIds } =
    await import("#/features/gear/server/loans-repo.server");
  const openLoans = await getOpenLoansForItemIds(active.map((r) => r.id));
  const eligible = active.filter((r) => !openLoans.has(r.id));
  if (eligible.length === 0) {
    return { affected: 0, skipped: input.publicIds.length };
  }
  // Combine the UPDATE and the audit INSERT into a single D1 round-trip.
  // Both writes target the same `eligible` set, so atomicity is a free
  // upgrade on top of the latency win.
  const deactivateStmt = buildBulkDeactivateStatement({
    ids: eligible.map((r) => r.id),
    status: input.status,
    deactivatedBy: principal.userId,
    reason: input.reason,
  });
  const auditStmt = buildBulkAuditEventStatement(
    eligible.map((r) => ({
      actorUserId: principal.userId,
      action: "gear.deactivated",
      targetType: "gear",
      targetId: r.id,
      metadata: {
        status: input.status,
        code: r.code,
        reason: input.reason,
        bulk: true,
      },
    })),
  );
  // Both statements are non-null here because `eligible.length > 0`.
  if (deactivateStmt && auditStmt) {
    await getDb().batch([deactivateStmt, auditStmt]);
  }
  return {
    affected: eligible.length,
    skipped: input.publicIds.length - eligible.length,
  };
}

export async function bulkReactivateGearAction(input: {
  publicIds: string[];
}): Promise<BulkResult> {
  const principal = await requireGearManager();
  const rows = await getGearItemsByPublicIds(input.publicIds);
  const eligible = rows.filter((r) => r.status !== "active");
  if (eligible.length === 0) {
    return { affected: 0, skipped: input.publicIds.length };
  }
  await bulkMarkGearItemsReactivated(eligible.map((r) => r.id));
  await recordAuditEvents(
    eligible.map((r) => ({
      actorUserId: principal.userId,
      action: "gear.reactivated",
      targetType: "gear",
      targetId: r.id,
      metadata: { bulk: true },
    })),
  );
  return {
    affected: eligible.length,
    skipped: input.publicIds.length - eligible.length,
  };
}

export async function bulkSetGearItemConditionAction(input: {
  publicIds: string[];
  condition: schema.GearCondition;
}): Promise<BulkResult> {
  const principal = await requireGearManager();
  const rows = await getGearItemsByPublicIds(input.publicIds);
  if (rows.length === 0) {
    return { affected: 0, skipped: input.publicIds.length };
  }
  await bulkSetGearItemCondition({
    ids: rows.map((r) => r.id),
    condition: input.condition,
  });
  await recordAuditEvents(
    rows.map((r) => ({
      actorUserId: principal.userId,
      action: "gear.updated",
      targetType: "gear",
      targetId: r.id,
      metadata: {
        changedFields: ["condition"],
        condition: input.condition,
        bulk: true,
      },
    })),
  );
  return {
    affected: rows.length,
    skipped: input.publicIds.length - rows.length,
  };
}

export async function bulkAddGearItemTagsAction(input: {
  publicIds: string[];
  tagPublicIds: string[];
}): Promise<BulkResult> {
  const principal = await requireGearManager();
  if (input.tagPublicIds.length === 0) {
    return { affected: 0, skipped: input.publicIds.length };
  }
  const rows = await getGearItemsByPublicIds(input.publicIds);
  const tags = await getGearTagsByPublicIds(input.tagPublicIds);
  if (rows.length === 0 || tags.length === 0) {
    return { affected: 0, skipped: input.publicIds.length };
  }
  await bulkAddGearItemTags({
    itemIds: rows.map((r) => r.id),
    tagIds: tags.map((t) => t.id),
    assignedBy: principal.userId,
  });
  // One audit row per gear (not per tag) — "tags_changed" is a
  // per-gear event in the singular path too, and N tags applied
  // together are most usefully recorded as a single event.
  await recordAuditEvents(
    rows.map((r) => ({
      actorUserId: principal.userId,
      action: "gear.tags_changed",
      targetType: "gear",
      targetId: r.id,
      metadata: {
        added: tags.map((t) => t.id),
        removed: [],
        bulk: true,
      },
    })),
  );
  return {
    affected: rows.length,
    skipped: input.publicIds.length - rows.length,
  };
}

/**
 * /history actions. Reads (`getHistoryContentAction`) are gated at
 * the route layer by `history:view`; writes (narrative, officer CRUD,
 * honorary CRUD) gate on `history:manage` here at the action layer and
 * record one audit event per mutation.
 *
 * The shape returned by the read action is grouped-by-year so the
 * view layer can render section headers cheaply.
 */
import { eq } from "drizzle-orm";

import type {
  CreateHistoricalOfficerInput,
  CreateHonoraryMemberInput,
  DeleteByIdInput,
  DeleteOfficersByYearInput,
  ReorderHonoraryMembersInput,
  UpdateHistoricalOfficerInput,
  UpdateHonoraryMemberInput,
} from "#/features/history/server/history-schemas";
import { requireHistoryManager } from "#/features/history/server/history-permissions.server";
import {
  listHistoricalOfficers,
  listHonoraryMembers,
} from "#/features/history/server/history-repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { getDb, schema } from "#/server/db";
import { readMarkdownPage } from "#/server/markdown-pages/markdown-pages-repo.server";

export interface OfficerEntry {
  id: number;
  role: string;
  roleOrder: number;
  name: string;
  notes: string | null;
}

export interface OfficerYearGroup {
  schoolYear: string;
  startYear: number;
  officers: OfficerEntry[];
}

export interface HonoraryEntry {
  id: number;
  name: string;
  notes: string | null;
}

export interface HistoryContent {
  narrativeMarkdown: string;
  officersByYear: OfficerYearGroup[];
  honoraryMembers: HonoraryEntry[];
}

export async function getHistoryContentAction(): Promise<HistoryContent> {
  const [narrativeMarkdown, officers, honorary] = await Promise.all([
    readMarkdownPage("history.narrative"),
    listHistoricalOfficers(),
    listHonoraryMembers(),
  ]);

  // Already sorted by start_year DESC, role_order ASC from the repo.
  // Group adjacent rows by schoolYear.
  const officersByYear: OfficerYearGroup[] = [];
  for (const row of officers) {
    const last = officersByYear.at(-1);
    if (last?.schoolYear === row.schoolYear) {
      last.officers.push({
        id: row.id,
        role: row.role,
        roleOrder: row.roleOrder,
        name: row.name,
        notes: row.notes,
      });
    } else {
      officersByYear.push({
        schoolYear: row.schoolYear,
        startYear: row.startYear,
        officers: [
          {
            id: row.id,
            role: row.role,
            roleOrder: row.roleOrder,
            name: row.name,
            notes: row.notes,
          },
        ],
      });
    }
  }

  return {
    narrativeMarkdown,
    officersByYear,
    honoraryMembers: honorary.map((h) => ({
      id: h.id,
      name: h.name,
      notes: h.notes,
    })),
  };
}

// ── mutations (history:manage) ──────────────────────────────────────────
//
// Narrative editing is handled by the generic markdown_pages action
// (see #/server/markdown-pages/markdown-pages-actions.server.ts) keyed
// on slug="history.narrative". The slug → permission map in
// `#/server/markdown-pages/slugs` routes that slug back to
// history:manage, so the per-page gate is preserved.

export async function createHistoricalOfficerAction(
  input: CreateHistoricalOfficerInput,
): Promise<{ id: number }> {
  const principal = await requireHistoryManager();
  const inserted = await getDb()
    .insert(schema.historicalOfficers)
    .values({
      schoolYear: input.schoolYear,
      startYear: input.startYear,
      role: input.role,
      roleOrder: input.roleOrder,
      name: input.name,
      notes: input.notes,
    })
    .returning({ id: schema.historicalOfficers.id });
  // drizzle's `.returning()` types this as a non-empty array on
  // single-row inserts; the destructure is just to name the value.
  const [{ id }] = inserted;
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "historical_officer.created",
    targetType: "historical_officer",
    targetId: String(id),
    metadata: {
      schoolYear: input.schoolYear,
      role: input.role,
    },
  });
  return { id };
}

export async function updateHistoricalOfficerAction(
  input: UpdateHistoricalOfficerInput,
): Promise<{ ok: true }> {
  const principal = await requireHistoryManager();
  const updated = await getDb()
    .update(schema.historicalOfficers)
    .set({
      schoolYear: input.schoolYear,
      startYear: input.startYear,
      role: input.role,
      roleOrder: input.roleOrder,
      name: input.name,
      notes: input.notes,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.historicalOfficers.id, input.id))
    .returning({ id: schema.historicalOfficers.id });
  if (updated.length === 0) {
    throw new Error("Officer entry not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "historical_officer.updated",
    targetType: "historical_officer",
    targetId: String(input.id),
    metadata: {
      schoolYear: input.schoolYear,
      role: input.role,
    },
  });
  return { ok: true };
}

export async function deleteHistoricalOfficersByYearAction(
  input: DeleteOfficersByYearInput,
): Promise<{ deletedCount: number; schoolYear: string | null }> {
  const principal = await requireHistoryManager();
  const deleted = await getDb()
    .delete(schema.historicalOfficers)
    .where(eq(schema.historicalOfficers.startYear, input.startYear))
    .returning({
      id: schema.historicalOfficers.id,
      schoolYear: schema.historicalOfficers.schoolYear,
    });
  const deletedCount = deleted.length;
  // Capture schoolYear from the deleted rows (rather than re-deriving
  // from startYear) so audit metadata reflects exactly what was in
  // the DB — handles the edge case where rows for one start_year
  // disagree on the school_year string.
  const schoolYear = deleted[0]?.schoolYear ?? null;
  if (deletedCount > 0) {
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "historical_officer.year_deleted",
      targetType: "historical_officer_year",
      targetId: String(input.startYear),
      metadata: {
        startYear: input.startYear,
        schoolYear,
        deletedCount,
      },
    });
  }
  return { deletedCount, schoolYear };
}

export async function deleteHistoricalOfficerAction(
  input: DeleteByIdInput,
): Promise<{ ok: true }> {
  const principal = await requireHistoryManager();
  const deleted = await getDb()
    .delete(schema.historicalOfficers)
    .where(eq(schema.historicalOfficers.id, input.id))
    .returning({
      schoolYear: schema.historicalOfficers.schoolYear,
      role: schema.historicalOfficers.role,
    });
  if (deleted.length === 0) {
    throw new Error("Officer entry not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "historical_officer.deleted",
    targetType: "historical_officer",
    targetId: String(input.id),
    metadata: {
      schoolYear: deleted[0]?.schoolYear,
      role: deleted[0]?.role,
    },
  });
  return { ok: true };
}

export async function createHonoraryMemberAction(
  input: CreateHonoraryMemberInput,
): Promise<{ id: number }> {
  const principal = await requireHistoryManager();
  const inserted = await getDb()
    .insert(schema.honoraryMembers)
    .values({
      name: input.name,
      sortOrder: input.sortOrder,
      notes: input.notes,
    })
    .returning({ id: schema.honoraryMembers.id });
  const [{ id }] = inserted;
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "honorary_member.created",
    targetType: "honorary_member",
    targetId: String(id),
    metadata: { name: input.name },
  });
  return { id };
}

export async function updateHonoraryMemberAction(
  input: UpdateHonoraryMemberInput,
): Promise<{ ok: true }> {
  const principal = await requireHistoryManager();
  const updated = await getDb()
    .update(schema.honoraryMembers)
    .set({
      name: input.name,
      sortOrder: input.sortOrder,
      notes: input.notes,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.honoraryMembers.id, input.id))
    .returning({ id: schema.honoraryMembers.id });
  if (updated.length === 0) {
    throw new Error("Honorary member not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "honorary_member.updated",
    targetType: "honorary_member",
    targetId: String(input.id),
    metadata: { name: input.name },
  });
  return { ok: true };
}

export async function reorderHonoraryMembersAction(
  input: ReorderHonoraryMembersInput,
): Promise<{ ok: true; count: number }> {
  const principal = await requireHistoryManager();
  const { ids } = input;
  if (ids.length === 0) {
    return { ok: true, count: 0 };
  }
  // Rewrite every row's sort_order to (index + 1) so the resulting
  // canonical order is dense (1..N) — keeps the read-side ordering
  // stable across mixed dataset operations (add → reorder → delete).
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = ids.map((id, idx) =>
    db
      .update(schema.honoraryMembers)
      .set({ sortOrder: idx + 1, updatedAt: now })
      .where(eq(schema.honoraryMembers.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "honorary_member.reordered",
    targetType: "honorary_member_list",
    targetId: "1",
    metadata: { count: ids.length },
  });
  return { ok: true, count: ids.length };
}

export async function deleteHonoraryMemberAction(
  input: DeleteByIdInput,
): Promise<{ ok: true }> {
  const principal = await requireHistoryManager();
  const deleted = await getDb()
    .delete(schema.honoraryMembers)
    .where(eq(schema.honoraryMembers.id, input.id))
    .returning({ name: schema.honoraryMembers.name });
  if (deleted.length === 0) {
    throw new Error("Honorary member not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "honorary_member.deleted",
    targetType: "honorary_member",
    targetId: String(input.id),
    metadata: { name: deleted[0]?.name },
  });
  return { ok: true };
}

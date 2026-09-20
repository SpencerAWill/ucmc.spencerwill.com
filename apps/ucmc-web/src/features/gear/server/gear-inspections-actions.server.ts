/**
 * Inspection log actions: record an inspection event for a single piece
 * of gear and read its inspection history. Inspections are append-only
 * — there is no edit or delete path. If an officer mistypes, the fix
 * is to record a new corrective inspection; the audit trail then shows
 * both events.
 *
 * Inspector identity is snapshotted at write time (`inspectorNameSnapshot`)
 * so the history still reads usefully after an officer leaves the club
 * and `inspector_user_id` nulls via `ON DELETE SET NULL`.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  requireGearInspector,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearItemByPublicId,
  insertGearInspection,
  listInspectionsForItem,
  listInspectionsForModel,
} from "#/features/gear/server/repo.server";
import { getGearModelByPublicId } from "#/features/gear/server/models-repo.server";
import type { GearInspectionRow } from "#/features/gear/server/repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";

export interface GearInspectionSummary {
  publicId: string;
  inspectedAt: Temporal.Instant;
  result: schema.GearInspectionResult;
  notes: string | null;
  /** Best-effort display name: live profile.fullName joined at read
   *  time, falling back to the snapshot if the inspector's profile or
   *  user row has been deleted. */
  inspectorName: string | null;
  createdAt: Temporal.Instant;
}

function toSummary(row: GearInspectionRow): GearInspectionSummary {
  return {
    publicId: row.publicId,
    inspectedAt: row.inspectedAt,
    result: row.result,
    notes: row.notes,
    inspectorName: row.inspectorDisplayName,
    createdAt: row.createdAt,
  };
}

/**
 * What was inspected: one coded piece, or a counted model as a batch.
 * Exactly one of the two, mirroring the `item_id` / `model_id` XOR on
 * the row itself — the same dual shape loans, holds and sweep entries
 * carry, and for the same reason: a counted model has no item rows, so
 * "looked over all the draws" has nowhere else to hang.
 */
export interface GearInspectionTargetInput {
  gearPublicId?: string;
  modelPublicId?: string;
}

/** A union rather than a pair of nullables, so the read below narrows
 *  to one branch instead of coalescing an id it knows is there. */
type ResolvedTarget =
  | { kind: "item"; id: string }
  | { kind: "model"; id: string };

type ResolveInspectionTargetResult =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; reason: "not_found" | "not_counted" };

async function resolveTarget(
  input: GearInspectionTargetInput,
): Promise<ResolveInspectionTargetResult> {
  if (input.modelPublicId !== undefined) {
    const model = await getGearModelByPublicId(input.modelPublicId);
    if (!model) {
      return { ok: false, reason: "not_found" };
    }
    // A coded model's units are inspected one at a time, by code — a
    // model-level row would record "all of them are fine" while saying
    // nothing about which harness was actually in somebody's hands, and
    // the per-item clocks would keep running regardless.
    if (model.tracking !== "counted") {
      return { ok: false, reason: "not_counted" };
    }
    return { ok: true, target: { kind: "model", id: model.id } };
  }
  if (input.gearPublicId === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const gear = await getGearItemByPublicId(input.gearPublicId);
  if (!gear) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, target: { kind: "item", id: gear.id } };
}

export async function listGearInspectionsAction(
  input: GearInspectionTargetInput,
): Promise<GearInspectionSummary[]> {
  await requireGearReader();
  const resolved = await resolveTarget(input);
  if (!resolved.ok) {
    // A coded model has no batch history rather than a broken one, so
    // the read answers with an empty list where the write refuses.
    if (resolved.reason === "not_counted") {
      return [];
    }
    throw new Error("Gear not found");
  }
  const rows =
    resolved.target.kind === "item"
      ? await listInspectionsForItem(resolved.target.id)
      : await listInspectionsForModel(resolved.target.id);
  return rows.map(toSummary);
}

export interface RecordGearInspectionInput extends GearInspectionTargetInput {
  /** Date/time the inspection physically happened, ms-since-epoch. */
  inspectedAt: number;
  result: schema.GearInspectionResult;
  notes: string | null;
}

export type RecordGearInspectionResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: "not_counted" };

async function loadActorName(userId: string): Promise<string> {
  // Snapshot the actor's display name at write time. We prefer the
  // profile's `fullName` (every approved member has a profile row);
  // unclaimed-pre-add users would have a `placeholderName` on `users`
  // instead, but they can't record inspections so we don't see them
  // here. If for any reason the profile lookup misses, fall through
  // to the email — better than recording an empty string.
  const db = getDb();
  const profileRows = await db
    .select({ fullName: schema.profiles.fullName })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1);
  const fullName = profileRows.at(0)?.fullName;
  if (fullName) return fullName;
  const emailRows = await db
    .select({ email: schema.userEmails.email })
    .from(schema.userEmails)
    .where(eq(schema.userEmails.userId, userId))
    .limit(1);
  return emailRows.at(0)?.email ?? "Unknown";
}

export async function recordGearInspectionAction(
  input: RecordGearInspectionInput,
): Promise<RecordGearInspectionResult> {
  const principal = await requireGearInspector();
  const resolved = await resolveTarget(input);
  if (!resolved.ok) {
    if (resolved.reason === "not_counted") {
      return { ok: false, reason: "not_counted" };
    }
    throw new Error("Gear not found");
  }
  const { kind, id: targetId } = resolved.target;
  const inspectorName = await loadActorName(principal.userId);
  const id = `gi_${uuidv7()}`;
  const publicId = generatePublicId();
  await insertGearInspection({
    id,
    publicId,
    itemId: kind === "item" ? targetId : null,
    modelId: kind === "model" ? targetId : null,
    inspectorUserId: principal.userId,
    inspectorNameSnapshot: inspectorName,
    inspectedAt: Temporal.Instant.fromEpochMilliseconds(input.inspectedAt),
    result: input.result,
    notes: input.notes,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_inspection.recorded",
    targetType: "gear",
    targetId,
    metadata: {
      inspectionId: id,
      result: input.result,
      inspectedAt: input.inspectedAt,
      // Which layer was inspected. Without it a reader of the log can't
      // tell a batch check of forty draws from one harness.
      level: kind,
    },
  });
  return { ok: true, publicId };
}

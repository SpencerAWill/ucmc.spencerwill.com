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
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearByPublicId,
  insertGearInspection,
  listInspectionsForGear,
} from "#/features/gear/server/repo.server";
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

export async function listGearInspectionsAction(input: {
  gearPublicId: string;
}): Promise<GearInspectionSummary[]> {
  await requireGearReader();
  const gear = await getGearByPublicId(input.gearPublicId);
  if (!gear) {
    throw new Error("Gear not found");
  }
  const rows = await listInspectionsForGear(gear.id);
  return rows.map(toSummary);
}

export interface RecordGearInspectionInput {
  gearPublicId: string;
  /** Date/time the inspection physically happened, ms-since-epoch. */
  inspectedAt: number;
  result: schema.GearInspectionResult;
  notes: string | null;
}

export type RecordGearInspectionResult = {
  ok: true;
  publicId: string;
};

async function loadActorName(userId: string): Promise<string> {
  // Snapshot the actor's display name at write time. We prefer the
  // profile's `fullName` (every approved member has a profile row);
  // unclaimed-pre-add users would have a `placeholderName` on `users`
  // instead, but they don't have `gear:manage` so we don't see them
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
  const principal = await requireGearManager();
  const gear = await getGearByPublicId(input.gearPublicId);
  if (!gear) {
    throw new Error("Gear not found");
  }
  const inspectorName = await loadActorName(principal.userId);
  const id = `gi_${uuidv7()}`;
  const publicId = generatePublicId();
  await insertGearInspection({
    id,
    publicId,
    gearId: gear.id,
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
    targetId: gear.id,
    metadata: {
      inspectionId: id,
      result: input.result,
      inspectedAt: input.inspectedAt,
    },
  });
  return { ok: true, publicId };
}

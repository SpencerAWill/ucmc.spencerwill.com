/**
 * Action implementations for gear-type server fns. Types partition the
 * inventory: each piece of gear belongs to exactly one type. The
 * type's `prefix` field is a UI hint only — see `gear-actions.server`
 * for how `suggestCodeForTypeAction` consumes it.
 *
 * Deleting a type is RESTRICTed by the foreign key while any gear (active
 * or retired) references it. The action catches that error and reports
 * it as a user-facing message rather than letting the FK error bubble.
 */
import { uuidv7 } from "uuidv7";

import { requireGearManager } from "#/features/gear/server/permissions.server";
import {
  deleteGearTypeById,
  getGearTypeByPublicId,
  insertGearType,
  listGearTypes,
  updateGearTypeById,
} from "#/features/gear/server/repo.server";
import type { GearTypeSummary } from "#/features/gear/server/gear-actions.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isForeignKeyViolation, isUniqueViolation } from "#/server/db";

export type { GearTypeSummary };

function toSummary(row: {
  publicId: string;
  name: string;
  prefix: string | null;
  description: string | null;
}): GearTypeSummary {
  return {
    publicId: row.publicId,
    name: row.name,
    prefix: row.prefix,
    description: row.description,
  };
}

export async function listGearTypesAction(): Promise<GearTypeSummary[]> {
  // gear:read is the read floor (members browse types so the filter UI
  // can populate even before they have gear:manage).
  const { requireGearReader } =
    await import("#/features/gear/server/permissions.server");
  await requireGearReader();
  const rows = await listGearTypes();
  return rows.map(toSummary);
}

export interface CreateGearTypeInput {
  name: string;
  prefix: string | null;
  description: string | null;
}

export type CreateGearTypeResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: "name_in_use" };

export async function createGearTypeAction(
  input: CreateGearTypeInput,
): Promise<CreateGearTypeResult> {
  const principal = await requireGearManager();
  const id = `gt_${uuidv7()}`;
  const publicId = generatePublicId();
  try {
    await insertGearType({
      id,
      publicId,
      name: input.name.trim(),
      prefix: input.prefix?.trim() || null,
      description: input.description?.trim() || null,
      createdBy: principal.userId,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: "name_in_use" };
    }
    throw err;
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_type.created",
    targetType: "gear_type",
    targetId: id,
    metadata: { name: input.name.trim(), prefix: input.prefix?.trim() ?? null },
  });
  return { ok: true, publicId };
}

export interface EditGearTypeInput {
  publicId: string;
  name: string;
  prefix: string | null;
  description: string | null;
}

export type EditGearTypeResult =
  | { ok: true }
  | { ok: false; reason: "name_in_use" };

export async function editGearTypeAction(
  input: EditGearTypeInput,
): Promise<EditGearTypeResult> {
  const principal = await requireGearManager();
  const existing = await getGearTypeByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear type not found");
  }
  const nextName = input.name.trim();
  const nextPrefix = input.prefix?.trim() || null;
  const nextDescription = input.description?.trim() || null;
  const changedFields: string[] = [];
  if (nextName !== existing.name) changedFields.push("name");
  if (nextPrefix !== existing.prefix) changedFields.push("prefix");
  if (nextDescription !== existing.description) {
    changedFields.push("description");
  }
  if (changedFields.length === 0) {
    return { ok: true };
  }
  try {
    await updateGearTypeById(existing.id, {
      name: nextName,
      prefix: nextPrefix,
      description: nextDescription,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: "name_in_use" };
    }
    throw err;
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_type.updated",
    targetType: "gear_type",
    targetId: existing.id,
    metadata: { changedFields },
  });
  return { ok: true };
}

export type DeleteGearTypeResult =
  | { ok: true }
  | { ok: false; reason: "in_use" };

export async function deleteGearTypeAction(input: {
  publicId: string;
}): Promise<DeleteGearTypeResult> {
  const principal = await requireGearManager();
  const existing = await getGearTypeByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear type not found");
  }
  try {
    await deleteGearTypeById(existing.id);
  } catch (err) {
    // RESTRICT-on-delete blocks the operation while any gear row
    // (active or retired) still references this type. Surface as a
    // typed result so the UI can prompt the officer to retire/move
    // pieces first.
    if (isForeignKeyViolation(err)) {
      return { ok: false, reason: "in_use" };
    }
    throw err;
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_type.deleted",
    targetType: "gear_type",
    targetId: existing.id,
    metadata: { name: existing.name },
  });
  return { ok: true };
}

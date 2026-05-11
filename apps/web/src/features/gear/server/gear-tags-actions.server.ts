/**
 * Action implementations for gear-tag server fns. Tags are flat
 * non-exclusive labels that can be attached to any number of gear
 * pieces via the gear_tag_assignments join table. Tag creation goes
 * through this action so the audit log captures who introduced a new
 * label vocabulary.
 */
import { uuidv7 } from "uuidv7";

import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  deleteGearTagById,
  getGearTagByPublicId,
  insertGearTag,
  listGearTags,
} from "#/features/gear/server/repo.server";
import type { GearTagSummary } from "#/features/gear/server/gear-actions.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isUniqueViolation } from "#/server/db";

export type { GearTagSummary };

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function listGearTagsAction(): Promise<GearTagSummary[]> {
  await requireGearReader();
  const rows = await listGearTags();
  return rows.map((r) => ({ publicId: r.publicId, name: r.name }));
}

export interface CreateGearTagInput {
  name: string;
}

export type CreateGearTagResult =
  | { ok: true; publicId: string; name: string }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "name_in_use" };

export async function createGearTagAction(
  input: CreateGearTagInput,
): Promise<CreateGearTagResult> {
  const principal = await requireGearManager();
  const name = normalizeTagName(input.name);
  if (name.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const id = `gtag_${uuidv7()}`;
  const publicId = generatePublicId();
  try {
    await insertGearTag({ id, publicId, name });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: "name_in_use" };
    }
    throw err;
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_tag.created",
    targetType: "gear_tag",
    targetId: id,
    metadata: { name },
  });
  return { ok: true, publicId, name };
}

export async function deleteGearTagAction(input: {
  publicId: string;
}): Promise<{ ok: true }> {
  const principal = await requireGearManager();
  const tag = await getGearTagByPublicId(input.publicId);
  if (!tag) {
    throw new Error("Gear tag not found");
  }
  // Tag assignments cascade-delete via FK, so retired+active gear lose
  // the label cleanly. Audit emits the tag name (non-PII) so the
  // historical row stays meaningful after the tag row is gone.
  await deleteGearTagById(tag.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_tag.deleted",
    targetType: "gear_tag",
    targetId: tag.id,
    metadata: { name: tag.name },
  });
  return { ok: true };
}

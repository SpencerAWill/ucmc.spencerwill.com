/**
 * Bulk-import action for gear. Mirrors the shape of
 * `preAddUnclaimedAction` — returns a `{ created, skipped }`
 * discriminated union so the client can surface per-row outcomes.
 *
 * Rows are inserted sequentially. Each row tries to claim its code (if
 * supplied); on `UNIQUE` violation the row is skipped with reason
 * `"code_in_use"`. A per-import collision check also catches duplicate
 * codes WITHIN the same payload, since the unique index can't tell us
 * which of two siblings won.
 *
 * **Audit emission is per-row and not in the same transaction as the
 * gear insert.** A failure between an insert succeeding and its audit
 * row landing would leave the gear row without its `gear.added`
 * event. That's the same risk every action in this feature accepts
 * (the audit log is observability, not load-bearing for any RBAC or
 * billing path), so we live with it rather than batching D1 writes
 * across an unbounded import.
 */
import { uuidv7 } from "uuidv7";

import { requireGearManager } from "#/features/gear/server/permissions.server";
import {
  getGearTypeByPublicId,
  insertGearItem,
  listGearTags,
  setGearItemTags,
} from "#/features/gear/server/repo.server";
import {
  findGearModelByName,
  insertGearModel,
} from "#/features/gear/server/models-repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isUniqueViolation } from "#/server/db";
import type { schema } from "#/server/db";

export interface BulkImportRow {
  typePublicId: string;
  code: string | null;
  /** Required free-form description / model. Rows with empty
   *  description are skipped with `missing_description`. */
  description?: string | null;
  /** Acquisition date as ms since epoch, or null. */
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
  // Optional extended attributes — passthroughs from the CSV. Omit /
  // null means "not supplied" (the column stays NULL).
  msrpCents?: number | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  manufacturedAt?: number | null;
  acquisitionKind?: schema.GearAcquisitionKind | null;
  /** Product name. With the model layer, a CSV row names its product
   *  and the import creates the model on demand — requiring officers to
   *  pre-create forty models by hand would make bulk import useless. */
  modelName: string;
  /** Tag NAMES (not publicIds). Resolved server-side against
   *  `gear_tags.name` (case-insensitive). Any unknown name skips the
   *  whole row with reason `tag_not_found`. */
  tagNames?: string[];
}

export interface BulkImportInput {
  rows: BulkImportRow[];
}

export interface BulkImportCreated {
  rowIndex: number;
  publicId: string;
  code: string | null;
}

export interface BulkImportSkipped {
  rowIndex: number;
  reason:
    | "type_not_found"
    | "code_in_use"
    | "code_duplicate_in_import"
    | "missing_description"
    | "tag_not_found"
    | "invalid";
  code: string | null;
  /** Populated when `reason === "tag_not_found"`: the tag name(s) that
   *  didn't match an existing `gear_tags.name` row. */
  missingTags?: string[];
}

export interface BulkImportResult {
  created: BulkImportCreated[];
  skipped: BulkImportSkipped[];
}

function normalizeCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const trimmed = code.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function bulkImportGearAction(
  input: BulkImportInput,
): Promise<BulkImportResult> {
  const principal = await requireGearManager();
  const created: BulkImportCreated[] = [];
  const skipped: BulkImportSkipped[] = [];

  const typeCache = new Map<string, string | null>(); // typePublicId -> typeId (null = not found)
  // `<typeId>\u0000<manufacturer>\u0000<modelName>` -> modelId. NUL as the
  // separator because it can't occur in any of the three parts, so two
  // different triples can never collide on one key.
  const modelCache = new Map<string, string>();
  const seenCodes = new Set<string>();

  // Resolve every tag name in the payload up-front against the
  // (typically small) `gear_tags` table. One round-trip vs. one per
  // row. Indexed by lowercased name for case-insensitive lookup; the
  // canonical id is what we'll insert into `gear_tag_assignments`.
  const tagsNeeded = new Set<string>();
  for (const row of input.rows) {
    for (const name of row.tagNames ?? []) {
      const lower = name.trim().toLowerCase();
      if (lower.length > 0) tagsNeeded.add(lower);
    }
  }
  const tagByLowerName = new Map<string, string>(); // lowerName -> tagId
  if (tagsNeeded.size > 0) {
    const allTags = await listGearTags({ includeInternal: true });
    for (const t of allTags) {
      tagByLowerName.set(t.name.toLowerCase(), t.id);
    }
  }

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const code = normalizeCode(row.code);
    // Description is now optional — the model carries the product name,
    // so a row only needs distinguishing marks when it has any. What the
    // row cannot go without is a model name.
    const description = (row.description ?? "").trim();
    if (row.modelName.trim().length === 0) {
      skipped.push({ rowIndex: i, reason: "missing_description", code });
      continue;
    }

    if (code !== null) {
      const lower = code.toLowerCase();
      if (seenCodes.has(lower)) {
        skipped.push({
          rowIndex: i,
          reason: "code_duplicate_in_import",
          code,
        });
        continue;
      }
      seenCodes.add(lower);
    }

    let typeId = typeCache.get(row.typePublicId);
    if (typeId === undefined) {
      const type = await getGearTypeByPublicId(row.typePublicId);
      typeId = type?.id ?? null;
      typeCache.set(row.typePublicId, typeId);
    }
    if (typeId === null) {
      skipped.push({ rowIndex: i, reason: "type_not_found", code });
      continue;
    }

    // Resolve tag names → ids. Unknown tags fail the whole row so the
    // import never silently drops officer-supplied tags; the officer
    // creates the canonical tag (via the tag-management dialog) and
    // re-runs the import.
    const tagIds: string[] = [];
    const missingTags: string[] = [];
    for (const rawName of row.tagNames ?? []) {
      const lower = rawName.trim().toLowerCase();
      if (lower.length === 0) continue;
      const id = tagByLowerName.get(lower);
      if (id === undefined) {
        missingTags.push(rawName.trim());
      } else if (!tagIds.includes(id)) {
        tagIds.push(id);
      }
    }
    if (missingTags.length > 0) {
      skipped.push({
        rowIndex: i,
        reason: "tag_not_found",
        code,
        missingTags,
      });
      continue;
    }

    // Resolve (or create) the model this row belongs to. Repeated rows
    // for the same product reuse it, which is the common case — a CSV
    // of forty draws is forty rows against one model.
    const manufacturer = normalizeOptional(row.manufacturer);
    const modelKey = `${typeId}\u0000${manufacturer ?? ""}\u0000${row.modelName}`;
    let modelId = modelCache.get(modelKey);
    if (modelId === undefined) {
      const existingModel = await findGearModelByName({
        typeId,
        manufacturer,
        name: row.modelName,
      });
      if (existingModel) {
        modelId = existingModel.id;
      } else {
        modelId = `gm_${uuidv7()}`;
        await insertGearModel({
          id: modelId,
          publicId: generatePublicId(),
          typeId,
          manufacturer,
          name: row.modelName,
          tracking: "coded",
          description: null,
          msrpCents: row.msrpCents ?? null,
          serviceLifeYears: null,
          inspectionIntervalDays: null,
          imageKey: null,
          productUrl: null,
          createdBy: principal.userId,
        });
        await recordAuditEvent({
          actorUserId: principal.userId,
          action: "gear_model.created",
          targetType: "gear",
          targetId: modelId,
          metadata: { name: row.modelName, manufacturer, bulk: true },
        });
      }
      modelCache.set(modelKey, modelId);
    }

    const id = `gi_${uuidv7()}`;
    const publicId = generatePublicId();
    try {
      await insertGearItem({
        id,
        publicId,
        modelId,
        code,
        description: normalizeOptional(description),
        // Bulk import doesn't support thumbnails — officers can upload
        // per-piece via the singular Add/Edit sheet after the fact.
        thumbnailKey: null,
        acquiredAt:
          row.acquiredAt === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(row.acquiredAt),
        manufacturedAt:
          row.manufacturedAt === null || row.manufacturedAt === undefined
            ? null
            : Temporal.Instant.fromEpochMilliseconds(row.manufacturedAt),
        acquisitionCostCents: row.acquisitionCostCents,
        acquisitionKind: row.acquisitionKind ?? null,
        serialNumber: normalizeOptional(row.serialNumber),
        notesMarkdown: null,
        condition: "serviceable",
        createdBy: principal.userId,
      });
    } catch (err) {
      if (isUniqueViolation(err) && code !== null) {
        skipped.push({ rowIndex: i, reason: "code_in_use", code });
        continue;
      }
      throw err;
    }

    // setGearItemTags runs after the insert — the gear row already exists
    // when this fires. A failure here throws out of the loop, leaving
    // a tag-less gear row behind. That's the same partial-failure
    // shape the per-row audit emission carries (see the file-level
    // comment): observability and tag attachment are non-load-bearing
    // for any RBAC / billing path, so we accept the risk rather than
    // rolling back the insert. An officer can re-tag the orphan row
    // via the singular Edit sheet.
    if (tagIds.length > 0) {
      await setGearItemTags({
        itemId: id,
        tagIds,
        assignedBy: principal.userId,
      });
    }

    // Pull the assigned tag IDs into the per-row audit metadata so a
    // future "who attached `color:red` to this piece?" query lands on
    // the import event without needing a join through
    // gear_tag_assignments. Tag IDs (not names) keep the metadata
    // stable across tag renames.
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "gear.added",
      targetType: "gear",
      targetId: id,
      metadata: {
        typeId,
        code,
        source: "bulk_import",
        ...(tagIds.length > 0 ? { tagIds } : {}),
      },
    });
    created.push({ rowIndex: i, publicId, code });
  }

  return { created, skipped };
}

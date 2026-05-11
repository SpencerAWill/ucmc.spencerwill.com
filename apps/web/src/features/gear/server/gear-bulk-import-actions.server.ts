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
 */
import { uuidv7 } from "uuidv7";

import { requireGearManager } from "#/features/gear/server/permissions.server";
import {
  getGearTypeByPublicId,
  insertGear,
} from "#/features/gear/server/repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isUniqueViolation } from "#/server/db";

export interface BulkImportRow {
  typePublicId: string;
  code: string | null;
  description: string | null;
  acquiredAt: Date | null;
  acquisitionCostCents: number | null;
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
    | "invalid";
  code: string | null;
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

export async function bulkImportGearAction(
  input: BulkImportInput,
): Promise<BulkImportResult> {
  const principal = await requireGearManager();
  const created: BulkImportCreated[] = [];
  const skipped: BulkImportSkipped[] = [];

  const typeCache = new Map<string, string | null>(); // typePublicId -> typeId (null = not found)
  const seenCodes = new Set<string>();

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const code = normalizeCode(row.code);

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

    const id = `g_${uuidv7()}`;
    const publicId = generatePublicId();
    try {
      await insertGear({
        id,
        publicId,
        typeId,
        code,
        description: row.description?.trim() || null,
        acquiredAt: row.acquiredAt,
        acquisitionCostCents: row.acquisitionCostCents,
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

    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "gear.added",
      targetType: "gear",
      targetId: id,
      metadata: { typeId, code, source: "bulk_import" },
    });
    created.push({ rowIndex: i, publicId, code });
  }

  return { created, skipped };
}

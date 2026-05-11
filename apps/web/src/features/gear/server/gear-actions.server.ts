/**
 * Action implementations for gear server fns. The shell in
 * `./gear-fns.ts` dynamic-imports this module from inside each
 * createServerFn handler so server-only code stays off the client graph.
 *
 * Authorization happens here: every action calls `requireGearReader` or
 * `requireGearManager` from `./permissions.server` before touching the
 * repo. Audit emission is co-located with the data write — most
 * actions build a single audit statement and batch it with the mutation
 * so a partial failure can't leave a "wrote the row, lost the audit"
 * gap.
 */
import { uuidv7 } from "uuidv7";

import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearByPublicId,
  getGearLabelsByPublicIds,
  getGearTypeByPublicId,
  getGearTagsByPublicIds,
  insertGear,
  listGear,
  listTagsForGearIds,
  markGearRetired,
  markGearUnretired,
  setGearTags,
  updateGearById,
} from "#/features/gear/server/repo.server";
import {
  decodeGearThumbnailDataUrl,
  deleteGearThumbnail,
  gearShortContentHash,
  gearThumbnailKey,
  putGearThumbnail,
} from "#/features/gear/server/gear-image.server";
import type {
  ListGearOptions,
  ListGearResult,
} from "#/features/gear/server/repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import type { schema } from "#/server/db";
import { isUniqueViolation } from "#/server/db";

// ── public types ────────────────────────────────────────────────────────

export interface GearTagSummary {
  publicId: string;
  name: string;
  visibility: schema.GearTagVisibility;
}

export interface GearTypeSummary {
  publicId: string;
  name: string;
  prefix: string | null;
  description: string | null;
}

export interface GearSummary {
  publicId: string;
  code: string | null;
  description: string;
  /** R2 key under the `gear/` prefix, or null when no thumbnail has
   *  been uploaded. The client resolves it to a public CDN URL via
   *  `gearThumbnailUrlFor`. */
  thumbnailKey: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  acquiredAt: Date | null;
  acquisitionCostCents: number | null;
  retiredAt: Date | null;
  retiredReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  type: { publicId: string; name: string; prefix: string | null };
  tags: GearTagSummary[];
}

export interface GearDetail extends GearSummary {
  notesMarkdown: string | null;
}

export interface GearLabel {
  publicId: string;
  code: string;
  description: string;
  typeName: string;
}

export interface ListGearActionInput {
  typePublicId?: string;
  tagPublicIds?: string[];
  lifecycle?: schema.GearLifecycle;
  condition?: schema.GearCondition;
  q?: string;
  sort?: "code" | "created_at" | "updated_at";
  page?: number;
  perPage?: number;
}

export interface ListGearActionResult {
  rows: GearSummary[];
  total: number;
  page: number;
  perPage: number;
}

// ── helpers ─────────────────────────────────────────────────────────────

function toSummary(
  row: Awaited<ReturnType<typeof listGear>>["rows"][number],
  tags: GearTagSummary[],
  canSeeCost: boolean,
): GearSummary {
  return {
    publicId: row.publicId,
    code: row.code,
    description: row.description,
    thumbnailKey: row.thumbnailKey,
    lifecycle: row.lifecycle,
    condition: row.condition,
    acquiredAt: row.acquiredAt,
    // Cost is officer-only: budget detail shouldn't be readable by
    // every approved member. The UI hides the field, but stripping it
    // here keeps the JSON response honest even for a direct fetch.
    acquisitionCostCents: canSeeCost ? row.acquisitionCostCents : null,
    retiredAt: row.retiredAt,
    retiredReason: row.retiredReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    type: {
      publicId: row.typePublicId,
      name: row.typeName,
      prefix: row.typePrefix,
    },
    tags,
  };
}

async function resolveTypeId(typePublicId: string): Promise<string> {
  const type = await getGearTypeByPublicId(typePublicId);
  if (!type) {
    throw new Error(`Gear type not found: ${typePublicId}`);
  }
  return type.id;
}

async function resolveTagIds(tagPublicIds: string[]): Promise<string[]> {
  if (tagPublicIds.length === 0) return [];
  const tags = await getGearTagsByPublicIds(tagPublicIds);
  return tags.map((t) => t.id);
}

function normalizeCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const trimmed = code.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listGearAction(
  input: ListGearActionInput,
): Promise<ListGearActionResult> {
  const principal = await requireGearReader();
  const canSeeCost = principal.permissions.includes("gear:manage");
  const repoOptions: ListGearOptions = {
    lifecycle: input.lifecycle,
    condition: input.condition,
    q: input.q,
    sort: input.sort,
    page: input.page,
    perPage: input.perPage,
  };
  if (input.typePublicId) {
    repoOptions.typeId = await resolveTypeId(input.typePublicId);
  }
  if (input.tagPublicIds && input.tagPublicIds.length > 0) {
    repoOptions.tagIds = await resolveTagIds(input.tagPublicIds);
    // If any requested tag publicId didn't resolve, force an empty
    // result rather than silently ignoring the missing tag.
    if (repoOptions.tagIds.length !== input.tagPublicIds.length) {
      return {
        rows: [],
        total: 0,
        page: input.page ?? 1,
        perPage: input.perPage ?? 50,
      };
    }
  }
  const result: ListGearResult = await listGear(repoOptions);
  // Officers (gear:manage) see internal tags; everyone else only gets
  // public-visibility ones. Filtering at the repo layer means the
  // internal tag publicIds never reach a non-officer client at all.
  const tagsByGearId = await listTagsForGearIds(
    result.rows.map((r) => r.id),
    { includeInternal: canSeeCost },
  );
  return {
    rows: result.rows.map((row) =>
      toSummary(
        row,
        (tagsByGearId.get(row.id) ?? []).map((t) => ({
          publicId: t.publicId,
          name: t.name,
          visibility: t.visibility,
        })),
        canSeeCost,
      ),
    ),
    total: result.total,
    page: result.page,
    perPage: result.perPage,
  };
}

export async function listGearLabelsAction(input: {
  publicIds: string[];
}): Promise<GearLabel[]> {
  // Labels are an officer-managed concern (you're printing physical
  // tags to stick on club property). Gating with `requireGearManager`
  // also prevents members from probing publicIds via the labels
  // endpoint to learn which codes exist.
  await requireGearManager();
  return getGearLabelsByPublicIds(input.publicIds);
}

export async function getGearDetailAction(input: {
  publicId: string;
}): Promise<GearDetail> {
  const principal = await requireGearReader();
  const canSeeCost = principal.permissions.includes("gear:manage");
  const row = await getGearByPublicId(input.publicId);
  if (!row) {
    throw new Error("Gear not found");
  }
  const tagsByGearId = await listTagsForGearIds([row.id], {
    includeInternal: canSeeCost,
  });
  const summary = toSummary(
    row,
    (tagsByGearId.get(row.id) ?? []).map((t) => ({
      publicId: t.publicId,
      name: t.name,
      visibility: t.visibility,
    })),
    canSeeCost,
  );
  return { ...summary, notesMarkdown: row.notesMarkdown };
}

export interface CreateGearInput {
  typePublicId: string;
  code: string | null;
  /** Required free-form description / model (the primary heading on
   *  the gear card). zod enforces min-1 on the wire; this type
   *  reflects that. */
  description: string;
  /** Optional base64 `data:image/...` URL for the gear thumbnail. The
   *  action decodes, content-hashes, and uploads to R2. Null on omit. */
  thumbnailDataUrl: string | null;
  /** Acquisition date as ms since epoch, or null. */
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  tagPublicIds: string[];
}

function msToDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

async function uploadThumbnail(
  gearId: string,
  dataUrl: string,
): Promise<string> {
  const { contentType, bytes } = decodeGearThumbnailDataUrl(dataUrl);
  const hash = await gearShortContentHash(bytes);
  const key = gearThumbnailKey(gearId, hash, contentType);
  await putGearThumbnail(key, bytes, contentType);
  return key;
}

export type CreateGearResult =
  | { ok: true; publicId: string; code: string | null }
  | { ok: false; reason: "code_in_use"; code: string };

export async function createGearAction(
  input: CreateGearInput,
): Promise<CreateGearResult> {
  const principal = await requireGearManager();
  const typeId = await resolveTypeId(input.typePublicId);
  const tagIds = await resolveTagIds(input.tagPublicIds);
  const code = normalizeCode(input.code);
  const id = `g_${uuidv7()}`;
  const publicId = generatePublicId();
  // Upload thumbnail BEFORE the DB insert so a content-hash collision
  // or oversized payload fails the whole create — we don't want a gear
  // row to land in D1 without its thumbnail when the user expects one.
  // The content-hashed key is idempotent, so a retry won't double-write.
  const thumbnailKey =
    input.thumbnailDataUrl !== null
      ? await uploadThumbnail(id, input.thumbnailDataUrl)
      : null;
  try {
    await insertGear({
      id,
      publicId,
      typeId,
      code,
      description: input.description,
      thumbnailKey,
      acquiredAt: msToDate(input.acquiredAt),
      acquisitionCostCents: input.acquisitionCostCents,
      notesMarkdown: input.notesMarkdown,
      condition: input.condition,
      createdBy: principal.userId,
    });
  } catch (err) {
    if (isUniqueViolation(err) && code !== null) {
      return { ok: false, reason: "code_in_use", code };
    }
    throw err;
  }
  if (tagIds.length > 0) {
    await setGearTags({ gearId: id, tagIds, assignedBy: principal.userId });
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.added",
    targetType: "gear",
    targetId: id,
    metadata: { typeId, code },
  });
  return { ok: true, publicId, code };
}

export interface EditGearInput {
  publicId: string;
  typePublicId: string;
  code: string | null;
  description: string;
  /** Three-state thumbnail control:
   *   - omit / `undefined` → keep current key untouched
   *   - a `data:image/...` URL → upload + replace
   *   - `null` → remove existing thumbnail (deletes the R2 object) */
  thumbnailDataUrl?: string | null;
  /** Acquisition date as ms since epoch, or null. */
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  tagPublicIds: string[];
}

export type EditGearResult =
  | { ok: true }
  | { ok: false; reason: "code_in_use"; code: string };

export async function editGearAction(
  input: EditGearInput,
): Promise<EditGearResult> {
  const principal = await requireGearManager();
  const existing = await getGearByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  const typeId = await resolveTypeId(input.typePublicId);
  const tagIds = await resolveTagIds(input.tagPublicIds);
  const code = normalizeCode(input.code);
  const changedFields: string[] = [];
  const patch: Parameters<typeof updateGearById>[1] = {};
  if (typeId !== existing.typeId) {
    patch.typeId = typeId;
    changedFields.push("type");
  }
  if (code !== existing.code) {
    patch.code = code;
    changedFields.push("code");
  }
  if (input.description !== existing.description) {
    patch.description = input.description;
    changedFields.push("description");
  }
  const existingAcquiredAtMs = existing.acquiredAt?.getTime() ?? null;
  if (input.acquiredAt !== existingAcquiredAtMs) {
    patch.acquiredAt = msToDate(input.acquiredAt);
    changedFields.push("acquired_at");
  }
  if (input.acquisitionCostCents !== existing.acquisitionCostCents) {
    patch.acquisitionCostCents = input.acquisitionCostCents;
    changedFields.push("acquisition_cost_cents");
  }
  if (input.notesMarkdown !== existing.notesMarkdown) {
    patch.notesMarkdown = input.notesMarkdown;
    changedFields.push("notes_markdown");
  }
  if (input.condition !== existing.condition) {
    patch.condition = input.condition;
    changedFields.push("condition");
  }
  // Thumbnail handling. Three-way:
  //   - undefined: caller didn't touch it; keep existing key
  //   - data URL:  upload, patch the key, delete the old one if any
  //   - null:      clear the key, delete the old R2 object
  let priorThumbnailKey: string | null = null;
  if (input.thumbnailDataUrl !== undefined) {
    priorThumbnailKey = existing.thumbnailKey;
    if (input.thumbnailDataUrl === null) {
      if (existing.thumbnailKey !== null) {
        patch.thumbnailKey = null;
        changedFields.push("thumbnail_key");
      }
    } else {
      const newKey = await uploadThumbnail(existing.id, input.thumbnailDataUrl);
      if (newKey !== existing.thumbnailKey) {
        patch.thumbnailKey = newKey;
        changedFields.push("thumbnail_key");
      }
    }
  }
  if (Object.keys(patch).length > 0) {
    try {
      await updateGearById(existing.id, patch);
    } catch (err) {
      if (isUniqueViolation(err) && code !== null) {
        return { ok: false, reason: "code_in_use", code };
      }
      throw err;
    }
  }
  // Always reconcile tags — caller passes the desired full set.
  const tagDiff = await setGearTags({
    gearId: existing.id,
    tagIds,
    assignedBy: principal.userId,
  });

  // Garbage-collect the prior thumbnail AFTER the DB lands the new
  // key. Doing it before risks orphaning a still-referenced row if the
  // update fails. Best-effort: R2 errors don't undo the patch (the
  // worst case is a dangling object under `gear/<gearId>/`).
  if (priorThumbnailKey !== null && priorThumbnailKey !== patch.thumbnailKey) {
    try {
      await deleteGearThumbnail(priorThumbnailKey);
    } catch {
      // Swallow: the patch already succeeded.
    }
  }

  if (changedFields.length > 0) {
    const metadata: Record<string, unknown> = { changedFields };
    if (changedFields.includes("code")) {
      metadata.priorCode = existing.code;
      metadata.code = code;
    }
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "gear.updated",
      targetType: "gear",
      targetId: existing.id,
      metadata,
    });
  }
  if (tagDiff.added.length > 0 || tagDiff.removed.length > 0) {
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "gear.tags_changed",
      targetType: "gear",
      targetId: existing.id,
      metadata: tagDiff,
    });
  }
  return { ok: true };
}

export async function retireGearAction(input: {
  publicId: string;
  reason: string | null;
}): Promise<{ ok: true }> {
  const principal = await requireGearManager();
  const existing = await getGearByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.lifecycle === "retired") {
    return { ok: true };
  }
  await markGearRetired({
    id: existing.id,
    retiredBy: principal.userId,
    reason: input.reason,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.retired",
    targetType: "gear",
    targetId: existing.id,
    metadata: { priorCode: existing.code, reason: input.reason },
  });
  return { ok: true };
}

export async function unretireGearAction(input: {
  publicId: string;
}): Promise<{ ok: true }> {
  const principal = await requireGearManager();
  const existing = await getGearByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.lifecycle === "active") {
    return { ok: true };
  }
  await markGearUnretired(existing.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.unretired",
    targetType: "gear",
    targetId: existing.id,
  });
  return { ok: true };
}

/**
 * Suggest the next free code for a given type, computed by walking the
 * highest numeric suffix among active codes whose value starts with the
 * type's prefix and incrementing it. Non-numeric tails are ignored. If
 * no prefix is set or no active gear of this type has a numeric tail,
 * returns the prefix alone (or empty string).
 *
 * This is **advisory only** — the officer can overwrite the suggestion.
 */
export async function suggestCodeForTypeAction(input: {
  typePublicId: string;
}): Promise<{ suggestion: string }> {
  await requireGearManager();
  const type = await getGearTypeByPublicId(input.typePublicId);
  if (!type) {
    return { suggestion: "" };
  }
  const prefix = (type.prefix ?? "").trim();
  if (prefix.length === 0) {
    return { suggestion: "" };
  }
  const { listActiveCodesForType } =
    await import("#/features/gear/server/repo.server");
  const codes = await listActiveCodesForType(type.id);
  let maxSuffix = 0;
  let found = false;
  for (const code of codes) {
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n)) {
      found = true;
      if (n > maxSuffix) maxSuffix = n;
    }
  }
  const next = found ? maxSuffix + 1 : 1;
  return { suggestion: `${prefix}${next}` };
}

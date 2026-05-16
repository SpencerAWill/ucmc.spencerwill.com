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
import { eq } from "drizzle-orm";

import { getDb, isUniqueViolation, schema } from "#/server/db";

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
  /** Coarse wear grade (excellent/good/fair) carried over from the
   *  legacy paper inventory. Orthogonal to `condition`. Null when no
   *  grade has been assigned. */
  conditionGrade: schema.GearConditionGrade | null;
  acquiredAt: Date | null;
  acquisitionCostCents: number | null;
  /** Officer-only (same gate as `acquisitionCostCents`). */
  msrpCents: number | null;
  manufacturer: string | null;
  retiredAt: Date | null;
  retiredReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  type: { publicId: string; name: string; prefix: string | null };
  tags: GearTagSummary[];
}

export interface GearDetail extends GearSummary {
  notesMarkdown: string | null;
  /** Manufacturer's serial number. Officer-only (same gate as
   *  `acquisitionCostCents` / `msrpCents`) — stripped for callers
   *  without `gear:manage`. */
  serialNumber: string | null;
  /** Currently open loan, if any. The `memberFullName` field is
   *  populated ONLY for officers (gear:loan) OR for the borrower
   *  themselves — anyone else with `gear:read` sees the borrower's
   *  identity stripped. The presence of `currentLoan` is itself not
   *  sensitive; just that someone has it out. */
  currentLoan: {
    publicId: string;
    dueAt: Date;
    memberFullName: string | null;
  } | null;
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
    conditionGrade: row.conditionGrade,
    acquiredAt: row.acquiredAt,
    // Cost is officer-only: budget detail shouldn't be readable by
    // every approved member. The UI hides the field, but stripping it
    // here keeps the JSON response honest even for a direct fetch.
    acquisitionCostCents: canSeeCost ? row.acquisitionCostCents : null,
    msrpCents: canSeeCost ? row.msrpCents : null,
    manufacturer: row.manufacturer,
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

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
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
  // tags to stick on club property). The gate is **intent-based, not
  // data-protective** — every field returned here (code, description,
  // typeName) is also reachable through `listGearAction` /
  // `getGearDetailAction` for any approved member. Don't loosen the
  // gate on the assumption that it's redundant; the value is making
  // "print labels" an officer affordance, and preventing a non-officer
  // from probing existence of a publicId via this endpoint.
  await requireGearManager();
  return getGearLabelsByPublicIds(input.publicIds);
}

export async function getGearDetailAction(input: {
  publicId: string;
}): Promise<GearDetail> {
  const principal = await requireGearReader();
  const canSeeCost = principal.permissions.includes("gear:manage");
  const canSeeBorrower = principal.permissions.includes("gear:loan");
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

  // Optional "currently on loan" join. Stripped of the borrower's name
  // for callers who don't have gear:loan AND aren't the borrower
  // themselves — the existence of an open loan is fine to surface, but
  // the identity of who has it leaks more than we want.
  const { getOpenLoanForGear } =
    await import("#/features/gear/server/loans-repo.server");
  const openLoan = await getOpenLoanForGear(row.id);
  let currentLoan: GearDetail["currentLoan"] = null;
  if (openLoan) {
    let memberFullName: string | null = null;
    if (canSeeBorrower || openLoan.memberUserId === principal.userId) {
      const db = getDb();
      const profileRows = await db
        .select({ fullName: schema.profiles.fullName })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, openLoan.memberUserId))
        .limit(1);
      memberFullName = profileRows.at(0)?.fullName ?? null;
    }
    currentLoan = {
      publicId: openLoan.publicId,
      dueAt: openLoan.dueAt,
      memberFullName,
    };
  }

  return {
    ...summary,
    notesMarkdown: row.notesMarkdown,
    // Serial rides the same officer-only gate as the financial fields.
    // Leaking serials to all approved members hands a thief a shopping
    // list — name/brand alone isn't enough to flip a piece, but serial
    // + brand correlates against marketplace listings.
    serialNumber: canSeeCost ? row.serialNumber : null,
    currentLoan,
  };
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
  // Extended attributes carried over from the legacy paper inventory.
  // Optional on the wire (omit = unknown / not supplied). The action
  // normalizes `undefined` to `null` at the boundary.
  msrpCents?: number | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  conditionGrade?: schema.GearConditionGrade | null;
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
      msrpCents: input.msrpCents,
      manufacturer: normalizeOptionalText(input.manufacturer),
      serialNumber: normalizeOptionalText(input.serialNumber),
      conditionGrade: input.conditionGrade,
      notesMarkdown: input.notesMarkdown,
      condition: input.condition,
      createdBy: principal.userId,
    });
  } catch (err) {
    // Roll the thumbnail back. We uploaded it before the insert (so a
    // failed upload wouldn't leave a gear row pointing at a missing
    // object), which means the inverse failure mode is now in play:
    // insert blew up but the R2 object exists. Best-effort delete keeps
    // us from accumulating orphans in `BUCKET_PUBLIC` across retries.
    if (thumbnailKey !== null) {
      try {
        await deleteGearThumbnail(thumbnailKey);
      } catch {
        // Swallow: the gear insert already failed; surfacing a second
        // error from cleanup obscures the real cause.
      }
    }
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
  // Same omit-means-no-change semantics as `thumbnailDataUrl`. Pass
  // `null` to clear the field, omit to leave it unchanged.
  msrpCents?: number | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  conditionGrade?: schema.GearConditionGrade | null;
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
  if (input.msrpCents !== undefined && input.msrpCents !== existing.msrpCents) {
    patch.msrpCents = input.msrpCents;
    changedFields.push("msrp_cents");
  }
  if (input.manufacturer !== undefined) {
    const next = normalizeOptionalText(input.manufacturer);
    if (next !== existing.manufacturer) {
      patch.manufacturer = next;
      changedFields.push("manufacturer");
    }
  }
  if (input.serialNumber !== undefined) {
    const next = normalizeOptionalText(input.serialNumber);
    if (next !== existing.serialNumber) {
      patch.serialNumber = next;
      changedFields.push("serial_number");
    }
  }
  if (
    input.conditionGrade !== undefined &&
    input.conditionGrade !== existing.conditionGrade
  ) {
    patch.conditionGrade = input.conditionGrade;
    changedFields.push("condition_grade");
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

export type RetireGearResult = { ok: true } | { ok: false; reason: "on_loan" };

export async function retireGearAction(input: {
  publicId: string;
  reason: string | null;
}): Promise<RetireGearResult> {
  const principal = await requireGearManager();
  const existing = await getGearByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.lifecycle === "retired") {
    return { ok: true };
  }
  // Block retire while the piece is on an open loan — retiring NULLs
  // the code, which would orphan the borrower's "see what I have out"
  // view. The FK is also RESTRICT as a defense-in-depth measure, but
  // we surface this as a typed result instead of letting the FK throw.
  const { getOpenLoanForGear } =
    await import("#/features/gear/server/loans-repo.server");
  const openLoan = await getOpenLoanForGear(existing.id);
  if (openLoan) {
    return { ok: false, reason: "on_loan" };
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

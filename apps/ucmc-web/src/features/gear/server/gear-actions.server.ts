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
  getGearItemByPublicId,
  getGearLabelsByPublicIds,
  getGearTypeByPublicId,
  getGearTagsByPublicIds,
  insertGearItem,
  listGearItems,
  listTagsForItemIds,
  markGearItemDeactivated,
  markGearItemReactivated,
  releaseGearItemCode,
  setGearItemTags,
  updateGearItemById,
} from "#/features/gear/server/repo.server";
import { getGearModelByPublicId } from "#/features/gear/server/models-repo.server";
import {
  resolveAttributeFilters,
  resolveAttributeWrites,
  toValueDtos,
} from "#/features/gear/server/attributes-actions.server";
import type { AttributeFacetInput } from "#/features/gear/server/attributes-actions.server";
import {
  listAttributeValuesForItems,
  listAttributeValuesForModels,
  setItemAttributeValues,
} from "#/features/gear/server/attributes-repo.server";
import type {
  GearAttributeValueDto,
  GearAttributeValueInput,
} from "#/features/gear/lib/attributes";
import {
  decodeGearThumbnailDataUrl,
  deleteGearThumbnail,
  gearShortContentHash,
  gearThumbnailKey,
  putGearThumbnail,
} from "#/features/gear/server/gear-image.server";
import type {
  ListGearItemOptions,
  ListGearItemsResult,
} from "#/features/gear/server/repo.server";
import { gearAvailability } from "#/features/gear/lib/availability";
import type { GearAvailability } from "#/features/gear/lib/availability";
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
  /** Default inspection cadence in days for items of this type, or null
   *  when the club doesn't track one. A model may override it. */
  inspectionIntervalDays: number | null;
}

export interface GearModelSummary {
  publicId: string;
  name: string;
  manufacturer: string | null;
  tracking: schema.GearTracking;
  /** Officer-only (same gate as `acquisitionCostCents`). */
  msrpCents: number | null;
  serviceLifeYears: number | null;
  imageKey: string | null;
}

export interface GearSummary {
  publicId: string;
  code: string | null;
  /** The item's own distinguishing note ("blue tape on the spine"), or
   *  the product name when it has none. Items no longer carry the
   *  product identity themselves — the model does. */
  description: string;
  /** R2 key for this unit's own photo, falling back to the model's
   *  product shot. Null when neither exists; the client resolves it to
   *  a public CDN URL via `gearThumbnailUrlFor`. */
  thumbnailKey: string | null;
  status: schema.GearStatus;
  condition: schema.GearCondition;
  whereabouts: schema.GearWhereabouts;
  whereaboutsAsOf: Temporal.Instant | null;
  whereaboutsNote: string | null;
  /** Date of manufacture — the clock service life runs from, which is
   *  NOT acquisition. Null when nobody has read it off the tag. */
  manufacturedAt: Temporal.Instant | null;
  acquiredAt: Temporal.Instant | null;
  /** Officer-only. */
  acquisitionCostCents: number | null;
  acquisitionKind: schema.GearAcquisitionKind | null;
  deactivatedAt: Temporal.Instant | null;
  deactivatedReason: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  model: GearModelSummary;
  type: { publicId: string; name: string; prefix: string | null };
  tags: GearTagSummary[];
  /** The rollup members browse by — see `lib/availability.ts` for the
   *  precedence. Derived, never stored. */
  availability: GearAvailability;
  /** When an open loan exists, the date it comes back. Null otherwise.
   *  "On loan, back Thursday" is the answer a member actually wants. */
  availableFrom: Temporal.Instant | null;
  /** True when the viewer is the one holding it. Cheaper here than
   *  making every call site compare ids. */
  isMine: boolean;
  /** Why it's held, when it is. Carried on the row because "Held for
   *  the Red River trip" is a real answer and "Unavailable" is not —
   *  the reason is written by officers for exactly this audience. */
  holdReason: string | null;
  holdEndsAt: Temporal.Instant | null;
}

export interface GearDetail extends GearSummary {
  notesMarkdown: string | null;
  /** Answers recorded against this piece and against its model, in one
   *  list. A member reading a harness page does not care which level
   *  "Size: M" was typed at, and splitting them into two sections
   *  would make the page argue with itself. */
  attributes: GearAttributeValueDto[];
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
    dueAt: Temporal.Instant;
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
  modelPublicId?: string;
  tagPublicIds?: string[];
  status?: schema.GearStatus;
  condition?: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  availability?: GearAvailability;
  /** Facet selections — one entry per definition, values OR'd within
   *  it and AND'd across entries. */
  attributes?: AttributeFacetInput[];
  q?: string;
  sort?: "code" | "created_at" | "updated_at" | "model";
  dir?: "asc" | "desc";
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
  row: Awaited<ReturnType<typeof listGearItems>>["rows"][number],
  tags: GearTagSummary[],
  canSeeCost: boolean,
  viewerUserId: string | null,
): GearSummary {
  const availability = gearAvailability({
    status: row.status,
    condition: row.condition,
    whereabouts: row.whereabouts,
    hasOpenLoan: row.openLoanId !== null,
    hasActiveHold: row.activeHoldId !== null,
  });
  return {
    availability,
    availableFrom: row.openLoanDueAt,
    // Only surfaced when the hold is what is actually blocking. A hold
    // sitting behind an open loan or a repair flag would otherwise
    // explain the wrong thing.
    holdReason: availability === "on_hold" ? row.activeHoldReason : null,
    holdEndsAt: availability === "on_hold" ? row.activeHoldEndsAt : null,
    isMine: viewerUserId !== null && row.openLoanMemberUserId === viewerUserId,
    publicId: row.publicId,
    code: row.code,
    description: row.description ?? row.modelName,
    thumbnailKey: row.thumbnailKey ?? row.modelImageKey,
    status: row.status,
    condition: row.condition,
    whereabouts: row.whereabouts,
    whereaboutsAsOf: row.whereaboutsAsOf,
    whereaboutsNote: row.whereaboutsNote,
    manufacturedAt: row.manufacturedAt,
    acquiredAt: row.acquiredAt,
    // Cost is officer-only: budget detail shouldn't be readable by
    // every approved member. The UI hides the field, but stripping it
    // here keeps the JSON response honest even for a direct fetch.
    acquisitionCostCents: canSeeCost ? row.acquisitionCostCents : null,
    acquisitionKind: row.acquisitionKind,
    deactivatedAt: row.deactivatedAt,
    deactivatedReason: row.deactivatedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    model: {
      publicId: row.modelPublicId,
      name: row.modelName,
      manufacturer: row.manufacturer,
      tracking: "coded",
      msrpCents: canSeeCost ? row.msrpCents : null,
      serviceLifeYears: row.serviceLifeYears,
      imageKey: row.modelImageKey,
    },
    type: {
      publicId: row.typePublicId,
      name: row.typeName,
      prefix: row.typePrefix,
    },
    tags,
  };
}

async function resolveModelId(modelPublicId: string): Promise<string> {
  return (await resolveModel(modelPublicId)).id;
}

/** The type comes back too: attribute definitions are scoped to types,
 *  and the item form only ever names a model. */
async function resolveModel(
  modelPublicId: string,
): Promise<{ id: string; typeId: string }> {
  const model = await getGearModelByPublicId(modelPublicId);
  if (!model) {
    throw new Error(`Gear model not found: ${modelPublicId}`);
  }
  return { id: model.id, typeId: model.typeId };
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
  const repoOptions: ListGearItemOptions = {
    status: input.status,
    condition: input.condition,
    whereabouts: input.whereabouts,
    availability: input.availability,
    q: input.q,
    sort: input.sort,
    dir: input.dir,
    page: input.page,
    perPage: input.perPage,
  };
  if (input.attributes && input.attributes.length > 0) {
    repoOptions.attributes = await resolveAttributeFilters(input.attributes);
  }
  if (input.typePublicId) {
    repoOptions.typeId = await resolveTypeId(input.typePublicId);
  }
  if (input.modelPublicId) {
    repoOptions.modelId = await resolveModelId(input.modelPublicId);
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
  const result: ListGearItemsResult = await listGearItems(repoOptions);
  // Officers (gear:manage) see internal tags; everyone else only gets
  // public-visibility ones. Filtering at the repo layer means the
  // internal tag publicIds never reach a non-officer client at all.
  const tagsByGearId = await listTagsForItemIds(
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
        principal.userId,
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
  const row = await getGearItemByPublicId(input.publicId);
  if (!row) {
    throw new Error("Gear not found");
  }
  const tagsByGearId = await listTagsForItemIds([row.id], {
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
    principal.userId,
  );

  // Optional "currently on loan" join. Stripped of the borrower's name
  // for callers who don't have gear:loan AND aren't the borrower
  // themselves — the existence of an open loan is fine to surface, but
  // the identity of who has it leaks more than we want.
  const { getOpenLoanForItem } =
    await import("#/features/gear/server/loans-repo.server");
  const openLoan = await getOpenLoanForItem(row.id);
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

  const [itemValues, modelValues] = await Promise.all([
    listAttributeValuesForItems([row.id]),
    listAttributeValuesForModels([row.modelId]),
  ]);

  return {
    ...summary,
    notesMarkdown: row.notesMarkdown,
    // Model answers first: they describe the product, and the
    // per-piece ones read as refinements of it.
    attributes: [
      ...toValueDtos(modelValues.get(row.modelId)),
      ...toValueDtos(itemValues.get(row.id)),
    ],
    // Serial rides the same officer-only gate as the financial fields.
    // Leaking serials to all approved members hands a thief a shopping
    // list — name/brand alone isn't enough to flip a piece, but serial
    // + brand correlates against marketplace listings.
    serialNumber: canSeeCost ? row.serialNumber : null,
    currentLoan,
  };
}

export interface CreateGearInput {
  /** Which product this unit is. Required — a one-off donation gets a
   *  thin model of its own rather than a null here. */
  modelPublicId: string;
  code: string | null;
  /** Distinguishing marks for this unit. Optional now that the model
   *  carries the product identity; it used to be the required
   *  catch-all for name, size and notes at once. */
  description: string | null;
  /** Optional base64 `data:image/...` URL for the gear thumbnail. The
   *  action decodes, content-hashes, and uploads to R2. Null on omit. */
  thumbnailDataUrl: string | null;
  /** Acquisition date as ms since epoch, or null. */
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
  // Extended attributes carried over from the legacy paper inventory.
  // Optional on the wire (omit = unknown / not supplied). The action
  // normalizes `undefined` to `null` at the boundary.
  serialNumber?: string | null;
  /** Date of manufacture in ms since epoch. The safety clock for soft
   *  goods runs from here, not from `acquiredAt`. */
  manufacturedAt?: number | null;
  acquisitionKind?: schema.GearAcquisitionKind | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  tagPublicIds: string[];
  /** Answers to the item-level attribute definitions attached to this
   *  model's type. Omitted entirely by callers that predate them (the
   *  bulk importer), which is why it is optional. */
  attributes?: GearAttributeValueInput[];
}

function msToInstant(ms: number | null): Temporal.Instant | null {
  return ms === null ? null : Temporal.Instant.fromEpochMilliseconds(ms);
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
  | { ok: false; reason: "code_in_use"; code: string }
  | { ok: false; reason: "invalid_attribute"; message: string };

export async function createGearAction(
  input: CreateGearInput,
): Promise<CreateGearResult> {
  const principal = await requireGearManager();
  const model = await resolveModel(input.modelPublicId);
  const modelId = model.id;
  const tagIds = await resolveTagIds(input.tagPublicIds);
  const code = normalizeCode(input.code);
  // Resolved before the insert and the thumbnail upload: a rejected
  // attribute must not leave a half-made item behind.
  const attributes = await resolveAttributeWrites({
    typeId: model.typeId,
    level: "item",
    inputs: input.attributes ?? [],
  });
  if (!attributes.ok) {
    return {
      ok: false,
      reason: "invalid_attribute",
      message: attributes.message,
    };
  }
  const id = `gi_${uuidv7()}`;
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
    await insertGearItem({
      id,
      publicId,
      modelId,
      code,
      description: normalizeOptionalText(input.description),
      thumbnailKey,
      manufacturedAt: msToInstant(input.manufacturedAt ?? null),
      acquiredAt: msToInstant(input.acquiredAt),
      acquisitionCostCents: input.acquisitionCostCents,
      acquisitionKind: input.acquisitionKind ?? null,
      serialNumber: normalizeOptionalText(input.serialNumber),
      notesMarkdown: input.notesMarkdown,
      condition: input.condition,
      whereabouts: input.whereabouts,
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
    await setGearItemTags({ itemId: id, tagIds, assignedBy: principal.userId });
  }
  await setItemAttributeValues(id, attributes.writes);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.added",
    targetType: "gear",
    targetId: id,
    metadata: { modelId, code },
  });
  return { ok: true, publicId, code };
}

export interface EditGearInput {
  publicId: string;
  modelPublicId: string;
  code: string | null;
  description: string | null;
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
  serialNumber?: string | null;
  manufacturedAt?: number | null;
  acquisitionKind?: schema.GearAcquisitionKind | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  whereaboutsNote?: string | null;
  tagPublicIds: string[];
  /** Omit to leave every answer untouched — the same omit-means-no-
   *  change semantics the other optional fields here use. */
  attributes?: GearAttributeValueInput[];
}

export type EditGearResult =
  | { ok: true }
  | { ok: false; reason: "code_in_use"; code: string }
  | { ok: false; reason: "invalid_attribute"; message: string };

export async function editGearAction(
  input: EditGearInput,
): Promise<EditGearResult> {
  const principal = await requireGearManager();
  const existing = await getGearItemByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  const model = await resolveModel(input.modelPublicId);
  const modelId = model.id;
  const tagIds = await resolveTagIds(input.tagPublicIds);
  const code = normalizeCode(input.code);
  const attributes =
    input.attributes === undefined
      ? null
      : await resolveAttributeWrites({
          typeId: model.typeId,
          level: "item",
          inputs: input.attributes,
        });
  if (attributes !== null && !attributes.ok) {
    return {
      ok: false,
      reason: "invalid_attribute",
      message: attributes.message,
    };
  }
  const changedFields: string[] = [];
  const patch: Parameters<typeof updateGearItemById>[1] = {};
  if (modelId !== existing.modelId) {
    patch.modelId = modelId;
    changedFields.push("model");
  }
  if (code !== existing.code) {
    patch.code = code;
    changedFields.push("code");
  }
  const nextDescription = normalizeOptionalText(input.description);
  if (nextDescription !== existing.description) {
    patch.description = nextDescription;
    changedFields.push("description");
  }
  const existingAcquiredAtMs = existing.acquiredAt?.epochMilliseconds ?? null;
  if (input.acquiredAt !== existingAcquiredAtMs) {
    patch.acquiredAt = msToInstant(input.acquiredAt);
    changedFields.push("acquired_at");
  }
  if (input.acquisitionCostCents !== existing.acquisitionCostCents) {
    patch.acquisitionCostCents = input.acquisitionCostCents;
    changedFields.push("acquisition_cost_cents");
  }
  const existingManufacturedAtMs =
    existing.manufacturedAt?.epochMilliseconds ?? null;
  if (
    input.manufacturedAt !== undefined &&
    input.manufacturedAt !== existingManufacturedAtMs
  ) {
    patch.manufacturedAt = msToInstant(input.manufacturedAt);
    changedFields.push("manufactured_at");
  }
  if (
    input.acquisitionKind !== undefined &&
    input.acquisitionKind !== existing.acquisitionKind
  ) {
    patch.acquisitionKind = input.acquisitionKind;
    changedFields.push("acquisition_kind");
  }
  if (input.serialNumber !== undefined) {
    const next = normalizeOptionalText(input.serialNumber);
    if (next !== existing.serialNumber) {
      patch.serialNumber = next;
      changedFields.push("serial_number");
    }
  }
  if (
    input.whereabouts !== undefined &&
    input.whereabouts !== existing.whereabouts
  ) {
    patch.whereabouts = input.whereabouts;
    // `missing` is inferred from a dated sweep, so an undated one tells
    // a manager nothing. Stamp now when an officer sets it by hand.
    patch.whereaboutsAsOf =
      input.whereabouts === "missing" ? Temporal.Now.instant() : null;
    changedFields.push("whereabouts");
  }
  if (input.whereaboutsNote !== undefined) {
    const next = normalizeOptionalText(input.whereaboutsNote);
    if (next !== existing.whereaboutsNote) {
      patch.whereaboutsNote = next;
      changedFields.push("whereabouts_note");
    }
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
      await updateGearItemById(existing.id, patch);
    } catch (err) {
      if (isUniqueViolation(err) && code !== null) {
        return { ok: false, reason: "code_in_use", code };
      }
      throw err;
    }
  }
  if (attributes !== null) {
    await setItemAttributeValues(existing.id, attributes.writes);
  }
  // Always reconcile tags — caller passes the desired full set.
  const tagDiff = await setGearItemTags({
    itemId: existing.id,
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

export type DeactivateGearResult =
  | { ok: true }
  | { ok: false; reason: "on_loan" };

/**
 * Move an item to a terminal status — `retired` (worn / aged out),
 * `lost` (written off) or `disposed` (sold, given away).
 *
 * **Does not touch the code.** Retiring used to NULL it so the string
 * could be reissued; codes are no longer recycled, so the label stays
 * bound to this item and every historical mention of "CH93" resolves to
 * one thing. `releaseGearItemCodeAction` frees one deliberately.
 */
export async function deactivateGearAction(input: {
  publicId: string;
  status: Exclude<schema.GearStatus, "active">;
  reason: string | null;
}): Promise<DeactivateGearResult> {
  const principal = await requireGearManager();
  const existing = await getGearItemByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.status === input.status) {
    return { ok: true };
  }
  // Blocked while the item is on an open loan: the borrower's "what do
  // I have out" view would lose it, and closing someone else's loan by
  // a side effect of retiring is not a decision this action should
  // make. The FK is RESTRICT as defense-in-depth; this surfaces it as a
  // typed result rather than letting the FK throw.
  const { getOpenLoanForItem } =
    await import("#/features/gear/server/loans-repo.server");
  const openLoan = await getOpenLoanForItem(existing.id);
  if (openLoan) {
    return { ok: false, reason: "on_loan" };
  }
  await markGearItemDeactivated({
    id: existing.id,
    status: input.status,
    deactivatedBy: principal.userId,
    reason: input.reason,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.deactivated",
    targetType: "gear",
    targetId: existing.id,
    metadata: {
      status: input.status,
      code: existing.code,
      reason: input.reason,
    },
  });
  return { ok: true };
}

/**
 * Undo a mis-click. The prior `deactivatedReason` is deliberately left
 * on the row — the old un-retire nulled it, which destroyed the record
 * of why a harness was pulled the moment someone reversed the call.
 */
export async function reactivateGearAction(input: {
  publicId: string;
}): Promise<{ ok: true }> {
  const principal = await requireGearManager();
  const existing = await getGearItemByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.status === "active") {
    return { ok: true };
  }
  await markGearItemReactivated(existing.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.reactivated",
    targetType: "gear",
    targetId: existing.id,
    metadata: {
      priorStatus: existing.status,
      priorReason: existing.deactivatedReason,
    },
  });
  return { ok: true };
}

/**
 * Free a code from an already-deactivated item so it can be reissued.
 *
 * The entire code-recycling story: deliberate, one item at a time, and
 * audited with the prior value. Refused on an active item — that would
 * silently un-label something still in service.
 */
export type ReleaseCodeResult =
  | { ok: true }
  | { ok: false; reason: "still_active" | "no_code" };

export async function releaseGearItemCodeAction(input: {
  publicId: string;
}): Promise<ReleaseCodeResult> {
  const principal = await requireGearManager();
  const existing = await getGearItemByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gear not found");
  }
  if (existing.status === "active") {
    return { ok: false, reason: "still_active" };
  }
  if (existing.code === null) {
    return { ok: false, reason: "no_code" };
  }
  await releaseGearItemCode(existing.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear.code_released",
    targetType: "gear",
    targetId: existing.id,
    metadata: { priorCode: existing.code },
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
  const { listCodesForType } =
    await import("#/features/gear/server/repo.server");
  const codes = await listCodesForType(type.id);
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

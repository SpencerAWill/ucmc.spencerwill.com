/**
 * Action implementations for gear models — the product layer between a
 * type ("Quickdraw") and the physical units under it.
 *
 * Models ride on `gear:manage` rather than a permission of their own.
 * They are the same officer surface as the items they group, and a
 * permission costs a migration plus a seed plus a role grant — worth
 * spending only when a surface can be delegated separately, which this
 * one can't.
 */
import { uuidv7 } from "uuidv7";

import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  countItemsForModel,
  deleteGearModelById,
  getGearModelByPublicId,
  insertGearModel,
  listGearModels,
  listStockForModel,
  listStockForModelIds,
  setStockLevel,
  updateGearModelById,
} from "#/features/gear/server/models-repo.server";
import {
  getGearTypeByPublicId,
  listGearModelBrowseRows,
} from "#/features/gear/server/repo.server";
import { liveHeldQuantityForModels } from "#/features/gear/server/holds-repo.server";
import { openLoanQuantityForModels } from "#/features/gear/server/loans-repo.server";
import {
  resolveAttributeWrites,
  toValueDtos,
} from "#/features/gear/server/attributes-actions.server";
import {
  listAttributeValuesForModels,
  setModelAttributeValues,
} from "#/features/gear/server/attributes-repo.server";
import type {
  GearAttributeValueDto,
  GearAttributeValueInput,
} from "#/features/gear/lib/attributes";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isUniqueViolation } from "#/server/db";
import type { schema } from "#/server/db";

export interface GearModelSummaryDto {
  publicId: string;
  name: string;
  manufacturer: string | null;
  tracking: schema.GearTracking;
  description: string | null;
  msrpCents: number | null;
  serviceLifeYears: number | null;
  inspectionIntervalDays: number | null;
  /** Resolved from the type when the model doesn't override it. */
  effectiveInspectionIntervalDays: number | null;
  imageKey: string | null;
  productUrl: string | null;
  type: { publicId: string; name: string; prefix: string | null };
  /** Counted models only: quantity per condition bucket. Empty for
   *  coded models, which count their item rows instead. */
  stock: Array<{ condition: schema.GearCondition; quantity: number }>;
  /** Counted models only, 0 for coded ones. Stock counts units out on
   *  loan, so the editor needs both numbers to show what is actually on
   *  the shelf — and a serviceable count below `onLoan` is refused. */
  onLoan: number;
  onHold: number;
  /** Model-level answers — the ones true of every unit. */
  attributes: GearAttributeValueDto[];
}

export async function listGearModelsAction(
  input: { typePublicId?: string } = {},
): Promise<GearModelSummaryDto[]> {
  await requireGearManager();
  let typeId: string | undefined;
  if (input.typePublicId) {
    const type = await getGearTypeByPublicId(input.typePublicId);
    // An unresolvable type means an empty list rather than an error:
    // the picker passes whatever is selected, and a stale selection
    // shouldn't blow up the form.
    if (!type) return [];
    typeId = type.id;
  }
  const rows = await listGearModels({ typeId });
  const countedIds = rows
    .filter((r) => r.tracking === "counted")
    .map((r) => r.id);
  const [stockByModel, onLoanByModel, heldByModel, valuesByModel] =
    await Promise.all([
      listStockForModelIds(countedIds),
      openLoanQuantityForModels(countedIds),
      liveHeldQuantityForModels(countedIds, Temporal.Now.instant()),
      listAttributeValuesForModels(rows.map((r) => r.id)),
    ]);
  return rows.map((r) => ({
    publicId: r.publicId,
    name: r.name,
    manufacturer: r.manufacturer,
    tracking: r.tracking,
    description: r.description,
    msrpCents: r.msrpCents,
    serviceLifeYears: r.serviceLifeYears,
    inspectionIntervalDays: r.inspectionIntervalDays,
    effectiveInspectionIntervalDays: r.effectiveInspectionIntervalDays,
    imageKey: r.imageKey,
    productUrl: r.productUrl,
    type: {
      publicId: r.typePublicId,
      name: r.typeName,
      prefix: r.typePrefix,
    },
    stock: stockByModel.get(r.id) ?? [],
    onLoan: onLoanByModel.get(r.id) ?? 0,
    onHold: heldByModel.get(r.id) ?? 0,
    attributes: toValueDtos(valuesByModel.get(r.id)),
  }));
}

export interface CreateGearModelInput {
  typePublicId: string;
  name: string;
  manufacturer: string | null;
  tracking: schema.GearTracking;
  description: string | null;
  msrpCents: number | null;
  serviceLifeYears: number | null;
  inspectionIntervalDays: number | null;
  productUrl: string | null;
  /** Answers to the model-level attribute definitions on this type. */
  attributes?: GearAttributeValueInput[];
}

export type CreateGearModelResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: "name_in_use" | "type_not_found" }
  | { ok: false; reason: "invalid_attribute"; message: string };

export async function createGearModelAction(
  input: CreateGearModelInput,
): Promise<CreateGearModelResult> {
  const principal = await requireGearManager();
  const type = await getGearTypeByPublicId(input.typePublicId);
  if (!type) {
    return { ok: false, reason: "type_not_found" };
  }
  const attributes = await resolveAttributeWrites({
    typeId: type.id,
    level: "model",
    inputs: input.attributes ?? [],
  });
  if (!attributes.ok) {
    return {
      ok: false,
      reason: "invalid_attribute",
      message: attributes.message,
    };
  }
  const id = `gm_${uuidv7()}`;
  const publicId = generatePublicId();
  const manufacturer =
    input.manufacturer && input.manufacturer.trim().length > 0
      ? input.manufacturer.trim()
      : null;
  try {
    await insertGearModel({
      id,
      publicId,
      typeId: type.id,
      manufacturer,
      name: input.name.trim(),
      tracking: input.tracking,
      description: input.description,
      msrpCents: input.msrpCents,
      serviceLifeYears: input.serviceLifeYears,
      inspectionIntervalDays: input.inspectionIntervalDays,
      imageKey: null,
      productUrl: input.productUrl,
      createdBy: principal.userId,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: "name_in_use" };
    }
    throw err;
  }
  await setModelAttributeValues(id, attributes.writes);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_model.created",
    targetType: "gear",
    targetId: id,
    metadata: { name: input.name, manufacturer, tracking: input.tracking },
  });
  return { ok: true, publicId };
}

/**
 * `typePublicId` is deliberately omitted. Nothing asks to move a model
 * between types, and it is not the one-field change it looks like:
 * attribute definitions are scoped per type, so a move would orphan
 * every model- and item-level answer under the old type, and the items
 * would keep codes carrying the old type's prefix.
 */
export interface UpdateGearModelInput extends Partial<
  Omit<CreateGearModelInput, "typePublicId">
> {
  publicId: string;
}

export type UpdateGearModelResult =
  | { ok: true }
  | { ok: false; reason: "name_in_use" | "not_found" | "has_items" }
  | { ok: false; reason: "invalid_attribute"; message: string };

export async function updateGearModelAction(
  input: UpdateGearModelInput,
): Promise<UpdateGearModelResult> {
  const principal = await requireGearManager();
  const existing = await getGearModelByPublicId(input.publicId);
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  // Flipping a model that already has item rows to `counted` would
  // strand them: counted stock is quantities, and the items would stop
  // being reachable while still holding their codes and loan history.
  // Officers must retire or move the items first.
  if (
    input.tracking === "counted" &&
    existing.tracking === "coded" &&
    (await countItemsForModel(existing.id)) > 0
  ) {
    return { ok: false, reason: "has_items" };
  }
  const attributes =
    input.attributes === undefined
      ? null
      : await resolveAttributeWrites({
          typeId: existing.typeId,
          level: "model",
          inputs: input.attributes,
        });
  if (attributes !== null && !attributes.ok) {
    return {
      ok: false,
      reason: "invalid_attribute",
      message: attributes.message,
    };
  }
  const patch: Parameters<typeof updateGearModelById>[1] = {};
  const changedFields: string[] = [];
  if (input.name !== undefined && input.name.trim() !== existing.name) {
    patch.name = input.name.trim();
    changedFields.push("name");
  }
  if (input.manufacturer !== undefined) {
    const next =
      input.manufacturer && input.manufacturer.trim().length > 0
        ? input.manufacturer.trim()
        : null;
    if (next !== existing.manufacturer) {
      patch.manufacturer = next;
      changedFields.push("manufacturer");
    }
  }
  if (input.tracking !== undefined && input.tracking !== existing.tracking) {
    patch.tracking = input.tracking;
    changedFields.push("tracking");
  }
  if (
    input.description !== undefined &&
    input.description !== existing.description
  ) {
    patch.description = input.description;
    changedFields.push("description");
  }
  if (input.msrpCents !== undefined && input.msrpCents !== existing.msrpCents) {
    patch.msrpCents = input.msrpCents;
    changedFields.push("msrp_cents");
  }
  if (
    input.serviceLifeYears !== undefined &&
    input.serviceLifeYears !== existing.serviceLifeYears
  ) {
    patch.serviceLifeYears = input.serviceLifeYears;
    changedFields.push("service_life_years");
  }
  if (
    input.inspectionIntervalDays !== undefined &&
    input.inspectionIntervalDays !== existing.inspectionIntervalDays
  ) {
    patch.inspectionIntervalDays = input.inspectionIntervalDays;
    changedFields.push("inspection_interval_days");
  }
  if (
    input.productUrl !== undefined &&
    input.productUrl !== existing.productUrl
  ) {
    patch.productUrl = input.productUrl;
    changedFields.push("product_url");
  }
  // The row goes first, and the attribute answers only once it lands.
  // The other order committed the answers and *then* found the rename
  // collided, leaving a partial save behind a refused submit — the
  // officer sees "name already in use" with half their edit applied.
  if (changedFields.length > 0) {
    try {
      await updateGearModelById(existing.id, patch);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, reason: "name_in_use" };
      }
      throw err;
    }
  }
  if (attributes !== null) {
    await setModelAttributeValues(existing.id, attributes.writes);
  }
  if (changedFields.length === 0) {
    return { ok: true };
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_model.updated",
    targetType: "gear",
    targetId: existing.id,
    metadata: { changedFields },
  });
  return { ok: true };
}

export type DeleteGearModelResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_items" };

export async function deleteGearModelAction(input: {
  publicId: string;
}): Promise<DeleteGearModelResult> {
  const principal = await requireGearManager();
  const existing = await getGearModelByPublicId(input.publicId);
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  // The FK is RESTRICT; this pre-check turns it into a typed result so
  // the UI can say "move these 12 items first" instead of surfacing a
  // constraint error.
  if ((await countItemsForModel(existing.id)) > 0) {
    return { ok: false, reason: "has_items" };
  }
  await deleteGearModelById(existing.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_model.deleted",
    targetType: "gear",
    targetId: existing.id,
    metadata: { name: existing.name, manufacturer: existing.manufacturer },
  });
  return { ok: true };
}

// ── browse by model ────────────────────────────────────────────────────

export interface GearModelBrowseDto {
  publicId: string;
  name: string;
  manufacturer: string | null;
  tracking: schema.GearTracking;
  imageKey: string | null;
  type: { publicId: string; name: string };
  /** Coded models: units bucketed by the same availability rollup the
   *  item list filters by. Counted models: all zero — their numbers
   *  come from `stock` instead. */
  total: number;
  available: number;
  onLoan: number;
  onHold: number;
  unavailable: number;
  retired: number;
  /** Counted models only. */
  stock: Array<{ condition: schema.GearCondition; quantity: number }>;
  /** What a member can actually take right now: available units for a
   *  coded model, serviceable stock minus what is out and held for a
   *  counted one. One number, because "can I borrow this" is one
   *  question whichever way the cave tracks it. */
  takeable: number;
  attributes: GearAttributeValueDto[];
}

export interface ListGearModelBrowseInput {
  typePublicId?: string;
  q?: string;
}

/**
 * The browse-by-model read. `gear:read`, not `gear:manage`: this is the
 * member-facing shape of the gear page, and the whole point of the
 * model layer was to answer "7 of 12 available" for them.
 */
export async function listGearModelBrowseAction(
  input: ListGearModelBrowseInput = {},
): Promise<GearModelBrowseDto[]> {
  await requireGearReader();
  let typeId: string | undefined;
  if (input.typePublicId) {
    const type = await getGearTypeByPublicId(input.typePublicId);
    if (!type) {
      return [];
    }
    typeId = type.id;
  }
  const rows = await listGearModelBrowseRows({ typeId, q: input.q });
  const countedIds = rows
    .filter((r) => r.tracking === "counted")
    .map((r) => r.modelId);
  const [stockByModel, heldByModel, onLoanByModel, valuesByModel] =
    await Promise.all([
      listStockForModelIds(countedIds),
      liveHeldQuantityForModels(countedIds, Temporal.Now.instant()),
      openLoanQuantityForModels(countedIds),
      listAttributeValuesForModels(rows.map((r) => r.modelId)),
    ]);

  return rows.map((row) => {
    const stock = stockByModel.get(row.modelId) ?? [];
    const serviceable =
      stock.find((s) => s.condition === "serviceable")?.quantity ?? 0;
    const takeable =
      row.tracking === "counted"
        ? // Subtract what is out and what is spoken for. Holds on a
          // counted model are quantities, so they reduce the number a
          // member sees rather than blocking a particular unit.
          Math.max(
            0,
            serviceable -
              (onLoanByModel.get(row.modelId) ?? 0) -
              (heldByModel.get(row.modelId) ?? 0),
          )
        : // Not `row.available`: an untagged piece counts as available
          // in the rollup — it is in the cave and nothing is wrong with
          // it — but the desk has nothing to scan, so promising it
          // under "1 of 2 available" sent a member for a harness they
          // would be refused.
          row.availableTakeable;
    // A counted model's flagged stock is its "needs attention" number.
    // Coded models got theirs from the item rollup and counted ones
    // reported nothing, so two draws waiting on a gate repair simply
    // vanished from a card that still called the other eighteen fine.
    const unavailable =
      row.tracking === "counted"
        ? stock
            .filter((s) => s.condition !== "serviceable")
            .reduce((sum, s) => sum + s.quantity, 0)
        : row.unavailable;
    return {
      publicId: row.modelPublicId,
      name: row.modelName,
      manufacturer: row.manufacturer,
      tracking: row.tracking,
      imageKey: row.imageKey,
      type: { publicId: row.typePublicId, name: row.typeName },
      total: row.total,
      available: row.available,
      onLoan: row.onLoan,
      onHold: row.onHold,
      unavailable,
      retired: row.retired,
      stock,
      takeable,
      attributes: toValueDtos(valuesByModel.get(row.modelId)),
    };
  });
}

// ── counted stock ──────────────────────────────────────────────────────

export interface SetGearModelStockInput {
  publicId: string;
  /** Absolute quantity per condition bucket. Buckets the caller leaves
   *  out are untouched — the editor sends all three, but an omission
   *  should mean "no change" rather than "zero". */
  stock: Array<{ condition: schema.GearCondition; quantity: number }>;
}

export type SetGearModelStockResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_counted" }
  | { ok: false; reason: "below_on_loan"; onLoan: number };

/**
 * The write path for counted stock. Until now `gear_stock_levels` was
 * read by browse, the sweep reconciliation and the model list, and
 * written by nothing at all — so a model flipped to `counted` had no
 * items (blocked by design) and no way to enter a quantity, and read
 * "0 takeable" forever. Marking a model counted was a dead end.
 *
 * Absolute quantities rather than deltas, because that is the shape the
 * answer arrives in: somebody counts the bin and types what they saw.
 * The audit row carries the before and after for each bucket it moved,
 * which is where the delta lives.
 */
export async function setGearModelStockAction(
  input: SetGearModelStockInput,
): Promise<SetGearModelStockResult> {
  const principal = await requireGearManager();
  const existing = await getGearModelByPublicId(input.publicId);
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  // A coded model counts its item rows. Accepting quantities for one
  // would create a second, disagreeing answer to "how many are there".
  if (existing.tracking !== "counted") {
    return { ok: false, reason: "not_counted" };
  }
  const before = await listStockForModel(existing.id);
  const quantityOf = (
    rows: Array<{ condition: schema.GearCondition; quantity: number }>,
    condition: schema.GearCondition,
  ) => rows.find((r) => r.condition === condition)?.quantity ?? 0;

  // Stock counts everything the club owns in a bucket, units out on
  // loan included, and `takeable` is serviceable minus what is out. So
  // a serviceable count below the open loan quantity doesn't describe
  // any real cave: it would clamp takeable to zero and quietly disagree
  // with the loan table. Refused with the number, so the officer can
  // see what they're up against rather than guess why the save bounced.
  const nextServiceable = input.stock.find(
    (s) => s.condition === "serviceable",
  );
  if (nextServiceable !== undefined) {
    const onLoan =
      (await openLoanQuantityForModels([existing.id])).get(existing.id) ?? 0;
    if (nextServiceable.quantity < onLoan) {
      return { ok: false, reason: "below_on_loan", onLoan };
    }
  }

  const changed: Array<{
    condition: schema.GearCondition;
    from: number;
    to: number;
  }> = [];
  for (const row of input.stock) {
    const from = quantityOf(before, row.condition);
    if (from === row.quantity) {
      continue;
    }
    await setStockLevel({
      modelId: existing.id,
      condition: row.condition,
      quantity: row.quantity,
    });
    changed.push({ condition: row.condition, from, to: row.quantity });
  }
  if (changed.length === 0) {
    return { ok: true };
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_model.stock_adjusted",
    targetType: "gear",
    targetId: existing.id,
    metadata: { name: existing.name, changed },
  });
  return { ok: true };
}

/**
 * Pure data access for gear models and the stock levels of counted
 * models. No auth, no business logic — the action modules own
 * authorization and audit emission.
 *
 * A model is the *product* ("BD HotForge 12cm"); items are the physical
 * units under it. `tracking` decides which of the two the cave actually
 * handles: `coded` models have item rows, `counted` models have stock
 * quantities and no items at all.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface GearModelRow {
  id: string;
  publicId: string;
  typeId: string;
  manufacturer: string | null;
  name: string;
  tracking: schema.GearTracking;
  description: string | null;
  msrpCents: number | null;
  serviceLifeYears: number | null;
  /** Batch date of manufacture — what a counted model's service-life
   *  clock runs from, since it has no item rows of its own. */
  manufacturedAt: Temporal.Instant | null;
  inspectionIntervalDays: number | null;
  imageKey: string | null;
  productUrl: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  typePublicId: string;
  typeName: string;
  typePrefix: string | null;
  /** The type's cadence unless the model overrides it. Resolved here so
   *  callers never have to remember the precedence. */
  effectiveInspectionIntervalDays: number | null;
}

const MODEL_COLUMNS = {
  id: schema.gearModels.id,
  publicId: schema.gearModels.publicId,
  typeId: schema.gearModels.typeId,
  manufacturer: schema.gearModels.manufacturer,
  name: schema.gearModels.name,
  tracking: schema.gearModels.tracking,
  description: schema.gearModels.description,
  msrpCents: schema.gearModels.msrpCents,
  serviceLifeYears: schema.gearModels.serviceLifeYears,
  manufacturedAt: schema.gearModels.manufacturedAt,
  inspectionIntervalDays: schema.gearModels.inspectionIntervalDays,
  imageKey: schema.gearModels.imageKey,
  productUrl: schema.gearModels.productUrl,
  createdAt: schema.gearModels.createdAt,
  updatedAt: schema.gearModels.updatedAt,
  typePublicId: schema.gearTypes.publicId,
  typeName: schema.gearTypes.name,
  typePrefix: schema.gearTypes.prefix,
  typeInspectionIntervalDays: schema.gearTypes.inspectionIntervalDays,
} as const;

function toModelRow(
  r: Omit<GearModelRow, "effectiveInspectionIntervalDays"> & {
    typeInspectionIntervalDays: number | null;
  },
): GearModelRow {
  const { typeInspectionIntervalDays, ...rest } = r;
  return {
    ...rest,
    effectiveInspectionIntervalDays:
      rest.inspectionIntervalDays ?? typeInspectionIntervalDays,
  };
}

export async function listGearModels(
  options: {
    typeId?: string;
    tracking?: schema.GearTracking;
  } = {},
): Promise<GearModelRow[]> {
  const db = getDb();
  const clauses = [];
  if (options.typeId) {
    clauses.push(eq(schema.gearModels.typeId, options.typeId));
  }
  if (options.tracking) {
    clauses.push(eq(schema.gearModels.tracking, options.tracking));
  }
  const rows = await db
    .select(MODEL_COLUMNS)
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .where(clauses.length === 0 ? undefined : and(...clauses))
    .orderBy(asc(schema.gearTypes.name), asc(schema.gearModels.name));
  return rows.map(toModelRow);
}

export async function getGearModelByPublicId(
  publicId: string,
): Promise<GearModelRow | null> {
  const db = getDb();
  const rows = await db
    .select(MODEL_COLUMNS)
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .where(eq(schema.gearModels.publicId, publicId))
    .limit(1);
  const row = rows.at(0);
  return row ? toModelRow(row) : null;
}

export async function getGearModelById(
  id: string,
): Promise<GearModelRow | null> {
  const db = getDb();
  const rows = await db
    .select(MODEL_COLUMNS)
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .where(eq(schema.gearModels.id, id))
    .limit(1);
  const row = rows.at(0);
  return row ? toModelRow(row) : null;
}

export async function getGearModelsByPublicIds(
  publicIds: string[],
): Promise<GearModelRow[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select(MODEL_COLUMNS)
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .where(inArray(schema.gearModels.publicId, publicIds));
  return rows.map(toModelRow);
}

export async function insertGearModel(input: {
  id: string;
  publicId: string;
  typeId: string;
  manufacturer: string | null;
  name: string;
  tracking: schema.GearTracking;
  description: string | null;
  msrpCents: number | null;
  serviceLifeYears: number | null;
  manufacturedAt: Temporal.Instant | null;
  inspectionIntervalDays: number | null;
  imageKey: string | null;
  productUrl: string | null;
  createdBy: string;
}): Promise<void> {
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.gearModels)
    .values({ ...input, createdAt: now, updatedAt: now });
}

export async function updateGearModelById(
  id: string,
  patch: Partial<{
    typeId: string;
    manufacturer: string | null;
    name: string;
    tracking: schema.GearTracking;
    description: string | null;
    msrpCents: number | null;
    serviceLifeYears: number | null;
    manufacturedAt: Temporal.Instant | null;
    inspectionIntervalDays: number | null;
    imageKey: string | null;
    productUrl: string | null;
  }>,
): Promise<void> {
  await getDb()
    .update(schema.gearModels)
    .set({ ...patch, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearModels.id, id));
}

export async function deleteGearModelById(id: string): Promise<void> {
  await getDb().delete(schema.gearModels).where(eq(schema.gearModels.id, id));
}

/** Items are RESTRICTed against model delete; this is the pre-check the
 *  action layer uses to return a typed error instead of an FK throw. */
export async function countItemsForModel(modelId: string): Promise<number> {
  const rows = await getDb()
    .select({ value: sql<number>`count(*)` })
    .from(schema.gearItems)
    .where(eq(schema.gearItems.modelId, modelId));
  return rows[0]?.value ?? 0;
}

// ── stock levels (counted models) ───────────────────────────────────────

export interface StockLevelRow {
  condition: schema.GearCondition;
  quantity: number;
}

export async function listStockForModel(
  modelId: string,
): Promise<StockLevelRow[]> {
  const rows = await getDb()
    .select({
      condition: schema.gearStockLevels.condition,
      quantity: schema.gearStockLevels.quantity,
    })
    .from(schema.gearStockLevels)
    .where(eq(schema.gearStockLevels.modelId, modelId));
  return rows;
}

export async function listStockForModelIds(
  modelIds: string[],
): Promise<Map<string, StockLevelRow[]>> {
  const map = new Map<string, StockLevelRow[]>();
  if (modelIds.length === 0) return map;
  const rows = await getDb()
    .select({
      modelId: schema.gearStockLevels.modelId,
      condition: schema.gearStockLevels.condition,
      quantity: schema.gearStockLevels.quantity,
    })
    .from(schema.gearStockLevels)
    .where(inArray(schema.gearStockLevels.modelId, modelIds));
  for (const row of rows) {
    const list = map.get(row.modelId) ?? [];
    list.push({ condition: row.condition, quantity: row.quantity });
    map.set(row.modelId, list);
  }
  return map;
}

/**
 * Set the absolute quantity for one condition bucket. Upserts, because
 * the first time a bucket is touched there is no row — and a missing row
 * and a zero row mean the same thing, so the caller shouldn't have to
 * know which it is dealing with.
 */
export async function setStockLevel(input: {
  modelId: string;
  condition: schema.GearCondition;
  quantity: number;
}): Promise<void> {
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.gearStockLevels)
    .values({ ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        schema.gearStockLevels.modelId,
        schema.gearStockLevels.condition,
      ],
      set: { quantity: input.quantity, updatedAt: now },
    });
}

/**
 * Move `quantity` units from one condition bucket to another — the shape
 * every real stock edit takes: four draws go from serviceable to
 * needs_repair, they don't appear or vanish.
 *
 * Clamped at zero on the source so a double-submit can't drive a bucket
 * negative. The caller is responsible for checking availability first;
 * this is the write, not the rule.
 */
export async function moveStock(input: {
  modelId: string;
  from: schema.GearCondition;
  to: schema.GearCondition;
  quantity: number;
}): Promise<void> {
  if (input.quantity <= 0 || input.from === input.to) return;
  const now = Temporal.Now.instant();
  const db = getDb();
  await db
    .update(schema.gearStockLevels)
    .set({
      quantity: sql`max(0, ${schema.gearStockLevels.quantity} - ${input.quantity})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.gearStockLevels.modelId, input.modelId),
        eq(schema.gearStockLevels.condition, input.from),
      ),
    );
  await db
    .insert(schema.gearStockLevels)
    .values({
      modelId: input.modelId,
      condition: input.to,
      quantity: input.quantity,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.gearStockLevels.modelId,
        schema.gearStockLevels.condition,
      ],
      set: {
        quantity: sql`${schema.gearStockLevels.quantity} + ${input.quantity}`,
        updatedAt: now,
      },
    });
}

/** Add to (or, with a negative delta, remove from) one bucket — used for
 *  acquisitions and for writing off units lost on a counted loan. */
export async function adjustStock(input: {
  modelId: string;
  condition: schema.GearCondition;
  delta: number;
}): Promise<void> {
  if (input.delta === 0) return;
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.gearStockLevels)
    .values({
      modelId: input.modelId,
      condition: input.condition,
      quantity: Math.max(0, input.delta),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.gearStockLevels.modelId,
        schema.gearStockLevels.condition,
      ],
      set: {
        quantity: sql`max(0, ${schema.gearStockLevels.quantity} + ${input.delta})`,
        updatedAt: now,
      },
    });
}

/**
 * Exact-match lookup on the (type, manufacturer, name) triple that
 * uniquely identifies a product. Backs bulk import's create-on-demand
 * path — a CSV of forty draws names its product once per row and must
 * land on one model, not forty.
 */
export async function findGearModelByName(input: {
  typeId: string;
  manufacturer: string | null;
  name: string;
}): Promise<{ id: string } | null> {
  const rows = await getDb()
    .select({ id: schema.gearModels.id })
    .from(schema.gearModels)
    .where(
      and(
        eq(schema.gearModels.typeId, input.typeId),
        input.manufacturer === null
          ? sql`${schema.gearModels.manufacturer} IS NULL`
          : eq(schema.gearModels.manufacturer, input.manufacturer),
        eq(schema.gearModels.name, input.name),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Pure data access for gear holds — "keep these six draws back for the
 * Red River trip".
 *
 * A hold is the softest of the blocking states: officer-overridable at
 * the desk and self-expiring at `endsAt`, which is why nothing has to
 * sweep expired rows. "Live" everywhere below means *unreleased and
 * inside its window*, evaluated against a caller-supplied `now` rather
 * than the database clock, so a test can pin it and the list, the
 * availability rollup and the desk all agree within one request.
 *
 * Dual-shape like loans: a hold names either a coded item or a counted
 * model with a quantity, enforced by a CHECK constraint.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface GearHoldRow {
  id: string;
  publicId: string;
  itemId: string | null;
  itemPublicId: string | null;
  itemCode: string | null;
  modelId: string;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  typeName: string;
  quantity: number;
  reason: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  releasedAt: Temporal.Instant | null;
  heldByUserId: string | null;
  heldByName: string | null;
  createdAt: Temporal.Instant;
}

/**
 * The same `coalesce` trick the loan queries use: a hold on an item
 * reaches its model through the item, a hold on a model names it
 * directly, and one query serves both rather than two near-identical
 * ones behind every surface that lists holds.
 */
const MODEL_VIA_HOLD_OR_ITEM = sql`${schema.gearModels.id} = coalesce(${schema.gearHolds.modelId}, ${schema.gearItems.modelId})`;

const HOLD_COLUMNS = {
  id: schema.gearHolds.id,
  publicId: schema.gearHolds.publicId,
  itemId: schema.gearHolds.itemId,
  itemPublicId: schema.gearItems.publicId,
  itemCode: schema.gearItems.code,
  modelId: schema.gearModels.id,
  modelPublicId: schema.gearModels.publicId,
  modelName: schema.gearModels.name,
  manufacturer: schema.gearModels.manufacturer,
  typeName: schema.gearTypes.name,
  quantity: schema.gearHolds.quantity,
  reason: schema.gearHolds.reason,
  startsAt: schema.gearHolds.startsAt,
  endsAt: schema.gearHolds.endsAt,
  releasedAt: schema.gearHolds.releasedAt,
  heldByUserId: schema.gearHolds.heldByUserId,
  /** Who set it aside. The officer deciding whether to release someone
   *  else's reservation needs to know whose it is. */
  heldByName: schema.profiles.fullName,
  createdAt: schema.gearHolds.createdAt,
} as const;

function holdsWithSubject() {
  return getDb()
    .select(HOLD_COLUMNS)
    .from(schema.gearHolds)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearHolds.itemId),
    )
    .innerJoin(schema.gearModels, MODEL_VIA_HOLD_OR_ITEM)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearHolds.heldByUserId),
    );
}

/** Unreleased and inside its window. Written once because the list,
 *  the per-item lookup and the quantity rollup must agree on it. */
function liveWhere(now: Temporal.Instant) {
  return and(
    isNull(schema.gearHolds.releasedAt),
    sql`${schema.gearHolds.startsAt} <= ${now.epochMilliseconds}`,
    sql`${schema.gearHolds.endsAt} > ${now.epochMilliseconds}`,
  );
}

export interface ListGearHoldsOptions {
  now: Temporal.Instant;
  /** Live only. The default is everything, because the manage view
   *  wants the recent past too — "who released the trip hold" is a
   *  question asked right after somebody does. */
  liveOnly?: boolean;
  itemId?: string;
  modelId?: string;
  limit?: number;
}

export async function listGearHolds(
  options: ListGearHoldsOptions,
): Promise<GearHoldRow[]> {
  const clauses = [] as Parameters<typeof and>;
  if (options.liveOnly) {
    clauses.push(liveWhere(options.now));
  }
  if (options.itemId) {
    clauses.push(eq(schema.gearHolds.itemId, options.itemId));
  }
  if (options.modelId) {
    // A model-level hold and a hold on one of that model's items are
    // both answers to "what is held on this product".
    clauses.push(
      or(
        eq(schema.gearHolds.modelId, options.modelId),
        eq(schema.gearItems.modelId, options.modelId),
      ),
    );
  }
  return (
    holdsWithSubject()
      .where(clauses.length === 0 ? undefined : and(...clauses))
      // Live holds first by soonest expiry, then released ones newest
      // first — the two halves answer different questions and sorting
      // them together by one key buries whichever is being looked for.
      .orderBy(
        asc(schema.gearHolds.releasedAt),
        asc(schema.gearHolds.endsAt),
        desc(schema.gearHolds.createdAt),
      )
      .limit(options.limit ?? 200)
  );
}

export async function getGearHoldByPublicId(
  publicId: string,
): Promise<GearHoldRow | null> {
  const rows = await holdsWithSubject()
    .where(eq(schema.gearHolds.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function insertGearHold(input: {
  id: string;
  publicId: string;
  itemId: string | null;
  modelId: string | null;
  quantity: number;
  reason: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  heldByUserId: string;
}): Promise<void> {
  await getDb().insert(schema.gearHolds).values(input);
}

export async function markGearHoldReleased(
  id: string,
  releasedByUserId: string,
): Promise<void> {
  await getDb()
    .update(schema.gearHolds)
    .set({ releasedAt: Temporal.Now.instant(), releasedByUserId })
    .where(eq(schema.gearHolds.id, id));
}

/** Is this specific item held right now, and if so by which hold. */
export async function liveHoldForItem(
  itemId: string,
  now: Temporal.Instant,
): Promise<GearHoldRow | null> {
  const rows = await holdsWithSubject()
    .where(and(eq(schema.gearHolds.itemId, itemId), liveWhere(now)))
    .orderBy(asc(schema.gearHolds.endsAt))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Held quantity per counted model — what the desk must subtract from
 * stock before handing anything out. Coded items are excluded: their
 * holds block the individual piece through the availability rollup,
 * and counting them here would subtract the same unit twice.
 */
export async function liveHeldQuantityForModels(
  modelIds: string[],
  now: Temporal.Instant,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (modelIds.length === 0) {
    return out;
  }
  const rows = await getDb()
    .select({
      modelId: schema.gearHolds.modelId,
      quantity: sql<number>`sum(${schema.gearHolds.quantity})`,
    })
    .from(schema.gearHolds)
    .where(and(inArray(schema.gearHolds.modelId, modelIds), liveWhere(now)))
    .groupBy(schema.gearHolds.modelId);
  for (const row of rows) {
    if (row.modelId !== null) {
      out.set(row.modelId, Number(row.quantity));
    }
  }
  return out;
}

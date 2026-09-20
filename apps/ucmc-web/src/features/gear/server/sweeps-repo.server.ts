/**
 * Pure data access for inventory sweeps — a cave-wide count, run by
 * several people scanning into the same open sweep at once.
 *
 * The shape exists because **presence is recorded and absence is
 * inferred at close**. A per-item "seen" checkbox could record presence
 * too, but it could not say *when* the cave was last looked at, which
 * is the whole basis for calling something missing and for the
 * `whereabouts_as_of` date that goes with it.
 */
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";

import { getDb, schema } from "#/server/db";

export interface GearSweepRow {
  id: string;
  publicId: string;
  startedAt: Temporal.Instant;
  startedByUserId: string | null;
  closedAt: Temporal.Instant | null;
  closedByUserId: string | null;
  notes: string | null;
}

export async function getOpenSweep(): Promise<GearSweepRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.gearInventorySweeps)
    .where(isNull(schema.gearInventorySweeps.closedAt))
    .orderBy(desc(schema.gearInventorySweeps.startedAt))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function getSweepByPublicId(
  publicId: string,
): Promise<GearSweepRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.gearInventorySweeps)
    .where(eq(schema.gearInventorySweeps.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function listSweeps(limit = 20): Promise<GearSweepRow[]> {
  return getDb()
    .select()
    .from(schema.gearInventorySweeps)
    .orderBy(desc(schema.gearInventorySweeps.startedAt))
    .limit(limit);
}

export async function insertSweep(input: {
  id: string;
  publicId: string;
  startedByUserId: string;
}): Promise<void> {
  await getDb().insert(schema.gearInventorySweeps).values(input);
}

export async function markSweepClosed(input: {
  id: string;
  closedByUserId: string;
  notes: string | null;
}): Promise<void> {
  await getDb()
    .update(schema.gearInventorySweeps)
    .set({
      closedAt: Temporal.Now.instant(),
      closedByUserId: input.closedByUserId,
      notes: input.notes,
    })
    .where(eq(schema.gearInventorySweeps.id, input.id));
}

export interface SweepEntryRow {
  itemId: string | null;
  itemPublicId: string | null;
  itemCode: string | null;
  modelId: string | null;
  modelName: string | null;
  quantityCounted: number;
  seenAt: Temporal.Instant;
  seenByUserId: string | null;
}

export async function listSweepEntries(
  sweepId: string,
): Promise<SweepEntryRow[]> {
  return getDb()
    .select({
      itemId: schema.gearInventorySweepEntries.itemId,
      itemPublicId: schema.gearItems.publicId,
      itemCode: schema.gearItems.code,
      modelId: schema.gearInventorySweepEntries.modelId,
      modelName: schema.gearModels.name,
      quantityCounted: schema.gearInventorySweepEntries.quantityCounted,
      seenAt: schema.gearInventorySweepEntries.seenAt,
      seenByUserId: schema.gearInventorySweepEntries.seenByUserId,
    })
    .from(schema.gearInventorySweepEntries)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearInventorySweepEntries.itemId),
    )
    .leftJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearInventorySweepEntries.modelId),
    )
    .where(eq(schema.gearInventorySweepEntries.sweepId, sweepId))
    .orderBy(desc(schema.gearInventorySweepEntries.seenAt));
}

/**
 * Records a sighting. Idempotent for coded items by the unique index on
 * `(sweep_id, item_id)`: two people scanning the same harness is the
 * normal case in a cave with three people working it, not an error.
 *
 * For a counted model the later count **replaces** the earlier one
 * rather than adding to it. Two people each counting the whole bin is
 * far likelier than two people splitting it, and a wrong total that
 * reads as a surplus is harder to notice than one that reads short.
 */
export async function upsertSweepEntry(input: {
  sweepId: string;
  itemId: string | null;
  modelId: string | null;
  quantityCounted: number;
  seenByUserId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.gearInventorySweepEntries)
    .values({ ...input, seenAt: Temporal.Now.instant() })
    .onConflictDoUpdate({
      target:
        input.itemId !== null
          ? [
              schema.gearInventorySweepEntries.sweepId,
              schema.gearInventorySweepEntries.itemId,
            ]
          : [
              schema.gearInventorySweepEntries.sweepId,
              schema.gearInventorySweepEntries.modelId,
            ],
      set: {
        quantityCounted: input.quantityCounted,
        seenAt: Temporal.Now.instant(),
        seenByUserId: input.seenByUserId,
      },
    });
}

export async function countSweepEntries(sweepId: string): Promise<number> {
  const rows = await getDb()
    .select({ value: count() })
    .from(schema.gearInventorySweepEntries)
    .where(eq(schema.gearInventorySweepEntries.sweepId, sweepId));
  return rows[0]?.value ?? 0;
}

export interface UncodedItemRow {
  publicId: string;
  description: string;
  typeName: string;
  /** Already logged in this sweep. The picker keeps them listed and
   *  ticked rather than dropping them, so an officer working down a
   *  shelf can see what they've already accounted for. */
  seen: boolean;
}

/**
 * Active pieces with no code, for the sweep's untagged-piece picker.
 *
 * A code is the only handle the scan box has, so an unlabelled item
 * could never be logged — and, being active and in the cave, it was
 * then marked missing at every single close, for ever. The fix is a way
 * to log it rather than an exclusion: the cave really does want to know
 * whether the untagged harness on the shelf is still there.
 *
 * Unfiltered by type: uncoded items are the exception rather than the
 * rule (a fresh-in-box piece nobody has laminated a tag for yet), so
 * the whole list is short enough to put in one picker.
 */
export async function listUncodedActiveItems(
  sweepId: string,
): Promise<UncodedItemRow[]> {
  const rows = await getDb()
    .select({
      publicId: schema.gearItems.publicId,
      itemDescription: schema.gearItems.description,
      modelName: schema.gearModels.name,
      manufacturer: schema.gearModels.manufacturer,
      typeName: schema.gearTypes.name,
      seenItemId: schema.gearInventorySweepEntries.itemId,
    })
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.gearInventorySweepEntries,
      and(
        eq(schema.gearInventorySweepEntries.itemId, schema.gearItems.id),
        eq(schema.gearInventorySweepEntries.sweepId, sweepId),
      ),
    )
    .where(
      and(eq(schema.gearItems.status, "active"), isNull(schema.gearItems.code)),
    )
    .orderBy(schema.gearTypes.name, schema.gearModels.name);
  return rows.map((r) => ({
    publicId: r.publicId,
    description:
      r.itemDescription ??
      [r.manufacturer, r.modelName].filter(Boolean).join(" "),
    typeName: r.typeName,
    seen: r.seenItemId !== null,
  }));
}

export interface UnseenItemRow {
  id: string;
  publicId: string;
  code: string | null;
  modelName: string;
  whereabouts: schema.GearWhereabouts;
}

/**
 * Active coded items nobody logged in this sweep — the candidates for
 * `missing`.
 *
 * Four exclusions, each for its own reason:
 *
 *   - **on an open loan** — legitimately absent, and marking it missing
 *     would accuse the borrower of losing what they signed out.
 *   - **at `repair`** — absent by arrangement, and the cave knows where.
 *   - **with an `officer`** — same.
 *   - **under a live hold** — also absent by arrangement: somebody
 *     pulled it from the bin for the trip the hold names. This one was
 *     missed at first, which made the close contradict the hold sitting
 *     right beside it in the same UI.
 *
 * An item already `missing` is deliberately *not* excluded: it is
 * still unseen, and re-stamping `whereabouts_as_of` is how "missing
 * since March" stays true rather than freezing at the first sweep that
 * noticed.
 */
export async function listUnseenActiveItems(
  sweepId: string,
  now: Temporal.Instant,
): Promise<UnseenItemRow[]> {
  const nowMs = now.epochMilliseconds;
  return getDb()
    .select({
      id: schema.gearItems.id,
      publicId: schema.gearItems.publicId,
      code: schema.gearItems.code,
      modelName: schema.gearModels.name,
      whereabouts: schema.gearItems.whereabouts,
    })
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .where(
      and(
        eq(schema.gearItems.status, "active"),
        sql`${schema.gearItems.whereabouts} NOT IN ('repair', 'officer')`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.gearInventorySweepEntries} e
          WHERE e.sweep_id = ${sweepId} AND e.item_id = ${schema.gearItems.id}
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.gearLoans} l
          WHERE l.item_id = ${schema.gearItems.id} AND l.returned_at IS NULL
        )`,
        // Held gear is absent by arrangement, exactly like a piece at
        // the shop or out with an officer: somebody pulled it from the
        // bin for Saturday's trip, which is what the hold says out loud.
        // Without this a live hold was the one deliberate absence the
        // close still called missing — and it is the absence with a
        // named officer and a written reason attached to it.
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.gearHolds} h
          WHERE h.item_id = ${schema.gearItems.id}
            AND h.released_at IS NULL
            AND h.starts_at <= ${nowMs}
            AND h.ends_at > ${nowMs}
        )`,
      ),
    )
    .orderBy(schema.gearItems.code);
}

export async function markItemsMissing(
  itemIds: string[],
  asOf: Temporal.Instant,
): Promise<void> {
  if (itemIds.length === 0) {
    return;
  }
  await getDb()
    .update(schema.gearItems)
    .set({ whereabouts: "missing", whereaboutsAsOf: asOf, updatedAt: asOf })
    .where(
      sql`${schema.gearItems.id} IN (${sql.join(
        itemIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
}

export interface CountedReconciliationRow {
  modelId: string;
  modelPublicId: string;
  modelName: string;
  typeName: string;
  /** What the stock table says the club owns, across all condition
   *  buckets. */
  expected: number;
  counted: number;
  onLoan: number;
}

/**
 * Counted models against what the sweep found.
 *
 * `expected` is total stock; `counted + onLoan` is what the sweep can
 * account for. The difference is a shortfall, reported rather than
 * written off — a miscount is likelier than four lost draws, and the
 * write-off should be somebody's decision.
 */
export async function reconcileCountedModels(
  sweepId: string,
): Promise<CountedReconciliationRow[]> {
  const rows = await getDb()
    .select({
      modelId: schema.gearModels.id,
      modelPublicId: schema.gearModels.publicId,
      modelName: schema.gearModels.name,
      typeName: schema.gearTypes.name,
      expected: sql<number>`(
        SELECT coalesce(sum(s.quantity), 0)
        FROM ${schema.gearStockLevels} s
        WHERE s.model_id = ${schema.gearModels.id}
      )`,
      counted: sql<number>`(
        SELECT coalesce(sum(e.quantity_counted), 0)
        FROM ${schema.gearInventorySweepEntries} e
        WHERE e.sweep_id = ${sweepId} AND e.model_id = ${schema.gearModels.id}
      )`,
      onLoan: sql<number>`(
        SELECT coalesce(sum(l.quantity - l.quantity_returned), 0)
        FROM ${schema.gearLoans} l
        WHERE l.model_id = ${schema.gearModels.id} AND l.returned_at IS NULL
      )`,
    })
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .where(eq(schema.gearModels.tracking, "counted"))
    .orderBy(schema.gearModels.name);
  return rows.map((row) => ({
    ...row,
    expected: Number(row.expected),
    counted: Number(row.counted),
    onLoan: Number(row.onLoan),
  }));
}

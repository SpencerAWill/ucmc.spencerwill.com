/**
 * Pure data access for gear items, types and tags. No auth, no business
 * logic — the action modules are responsible for authorization and audit
 * emission. Models and stock levels live in `models-repo.server.ts`.
 *
 * Tag joins are handled with a second query rather than SQL aggregation:
 * after the item page is loaded we fetch every tag assignment for the
 * matching item IDs and merge in TypeScript. Two D1 round-trips total
 * per list request, but the shape is straightforward and easy to test.
 */
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { GearAvailability } from "#/features/gear/lib/availability";
import { getDb, likeContains, schema } from "#/server/db";

/**
 * One physical unit, with its model and type flattened in. Members never
 * see a bare item — "CH93" means nothing without "Petzl Corax harness"
 * beside it — so every read path joins both levels rather than making
 * callers stitch them.
 */
export interface GearItemRow {
  id: string;
  publicId: string;
  modelId: string;
  code: string | null;
  serialNumber: string | null;
  description: string | null;
  thumbnailKey: string | null;
  manufacturedAt: Temporal.Instant | null;
  acquiredAt: Temporal.Instant | null;
  acquisitionCostCents: number | null;
  acquisitionKind: schema.GearAcquisitionKind | null;
  notesMarkdown: string | null;
  status: schema.GearStatus;
  condition: schema.GearCondition;
  whereabouts: schema.GearWhereabouts;
  whereaboutsAsOf: Temporal.Instant | null;
  whereaboutsNote: string | null;
  deactivatedAt: Temporal.Instant | null;
  deactivatedReason: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  msrpCents: number | null;
  serviceLifeYears: number | null;
  modelImageKey: string | null;
  typeId: string;
  typePublicId: string;
  typeName: string;
  typePrefix: string | null;
  /** Open loan, joined here rather than fetched per row — the list used
   *  to carry no loan state at all, which is why the page could not
   *  sort or filter by "can I borrow this". */
  openLoanId: string | null;
  openLoanDueAt: Temporal.Instant | null;
  openLoanMemberUserId: string | null;
  /** An unreleased hold whose window covers now. */
  activeHoldId: string | null;
  activeHoldReason: string | null;
  activeHoldEndsAt: Temporal.Instant | null;
}

const ITEM_COLUMNS = {
  id: schema.gearItems.id,
  publicId: schema.gearItems.publicId,
  modelId: schema.gearItems.modelId,
  code: schema.gearItems.code,
  serialNumber: schema.gearItems.serialNumber,
  description: schema.gearItems.description,
  thumbnailKey: schema.gearItems.thumbnailKey,
  manufacturedAt: schema.gearItems.manufacturedAt,
  acquiredAt: schema.gearItems.acquiredAt,
  acquisitionCostCents: schema.gearItems.acquisitionCostCents,
  acquisitionKind: schema.gearItems.acquisitionKind,
  notesMarkdown: schema.gearItems.notesMarkdown,
  status: schema.gearItems.status,
  condition: schema.gearItems.condition,
  whereabouts: schema.gearItems.whereabouts,
  whereaboutsAsOf: schema.gearItems.whereaboutsAsOf,
  whereaboutsNote: schema.gearItems.whereaboutsNote,
  deactivatedAt: schema.gearItems.deactivatedAt,
  deactivatedReason: schema.gearItems.deactivatedReason,
  createdAt: schema.gearItems.createdAt,
  updatedAt: schema.gearItems.updatedAt,
  modelPublicId: schema.gearModels.publicId,
  modelName: schema.gearModels.name,
  manufacturer: schema.gearModels.manufacturer,
  msrpCents: schema.gearModels.msrpCents,
  serviceLifeYears: schema.gearModels.serviceLifeYears,
  modelImageKey: schema.gearModels.imageKey,
  typeId: schema.gearTypes.id,
  typePublicId: schema.gearTypes.publicId,
  typeName: schema.gearTypes.name,
  typePrefix: schema.gearTypes.prefix,
  openLoanId: schema.gearLoans.id,
  openLoanDueAt: schema.gearLoans.dueAt,
  openLoanMemberUserId: schema.gearLoans.memberUserId,
  activeHoldId: schema.gearHolds.id,
  activeHoldReason: schema.gearHolds.reason,
  activeHoldEndsAt: schema.gearHolds.endsAt,
} as const;

/**
 * Item → model → type, plus the open loan and any live hold.
 *
 * Both LEFT JOINs are safe against fan-out for different reasons: the
 * partial unique index guarantees at most one open loan per item, and
 * the hold join is capped by picking the earliest-ending live hold in a
 * correlated subquery rather than joining the whole set. Without that
 * cap two overlapping holds on one item would duplicate its row.
 */
function itemsWithModelAndType() {
  const now = sql`(unixepoch() * 1000)`;
  return getDb()
    .select(ITEM_COLUMNS)
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
      schema.gearLoans,
      and(
        eq(schema.gearLoans.itemId, schema.gearItems.id),
        sql`${schema.gearLoans.returnedAt} IS NULL`,
      ),
    )
    .leftJoin(
      schema.gearHolds,
      sql`${schema.gearHolds.id} = (
        SELECT h.id FROM ${schema.gearHolds} h
        WHERE h.item_id = ${schema.gearItems.id}
          AND h.released_at IS NULL
          AND h.starts_at <= ${now}
          AND h.ends_at > ${now}
        ORDER BY h.ends_at ASC
        LIMIT 1
      )`,
    );
}

export interface ListGearItemFilters {
  typeId?: string;
  modelId?: string;
  tagIds?: string[];
  status?: schema.GearStatus;
  condition?: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  /** The member-facing rollup. Pushed into SQL rather than filtered in
   *  TypeScript so paging and totals stay correct — filtering a page
   *  after the fact returns short pages and a lying count. */
  availability?: GearAvailability;
  q?: string;
}

export type GearItemSortKey = "code" | "created_at" | "updated_at" | "model";

export interface ListGearItemOptions extends ListGearItemFilters {
  sort?: GearItemSortKey;
  dir?: "asc" | "desc";
  page?: number;
  perPage?: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 250;

function itemWhere(filters: ListGearItemFilters) {
  const clauses = [] as Parameters<typeof and>;
  if (filters.typeId) {
    clauses.push(eq(schema.gearModels.typeId, filters.typeId));
  }
  if (filters.modelId) {
    clauses.push(eq(schema.gearItems.modelId, filters.modelId));
  }
  if (filters.status) {
    clauses.push(eq(schema.gearItems.status, filters.status));
  }
  if (filters.condition) {
    clauses.push(eq(schema.gearItems.condition, filters.condition));
  }
  if (filters.whereabouts) {
    clauses.push(eq(schema.gearItems.whereabouts, filters.whereabouts));
  }
  if (filters.availability) {
    clauses.push(availabilityWhere(filters.availability));
  }
  if (filters.q && filters.q.trim().length > 0) {
    const q = filters.q.trim();
    // Model name and manufacturer are in here deliberately: typing
    // "Black Diamond" or "Corax" is how a member searches, and before
    // the model layer those words only existed as free text on each row.
    clauses.push(
      or(
        likeContains(schema.gearItems.code, q),
        likeContains(schema.gearItems.description, q),
        likeContains(schema.gearItems.notesMarkdown, q),
        likeContains(schema.gearModels.name, q),
        likeContains(schema.gearModels.manufacturer, q),
      ),
    );
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const tagIds = filters.tagIds;
    clauses.push(
      sql`${schema.gearItems.id} IN (
        SELECT ${schema.gearTagAssignments.itemId}
        FROM ${schema.gearTagAssignments}
        WHERE ${inArray(schema.gearTagAssignments.tagId, tagIds)}
        GROUP BY ${schema.gearTagAssignments.itemId}
        HAVING COUNT(DISTINCT ${schema.gearTagAssignments.tagId}) = ${tagIds.length}
      )`,
    );
  }
  return clauses.length === 0 ? undefined : and(...clauses);
}

/**
 * SQL mirror of `gearAvailability`. The two must agree: this decides
 * which rows come back, that decides what each one is labelled, and a
 * disagreement shows up as an item filtered to "Available" wearing an
 * "On loan" badge. Kept adjacent and in the same precedence order so a
 * change to one is an obvious prompt to change the other.
 */
function availabilityWhere(availability: GearAvailability) {
  const active = eq(schema.gearItems.status, "active");
  const onLoan = sql`${schema.gearLoans.id} IS NOT NULL`;
  const notOnLoan = sql`${schema.gearLoans.id} IS NULL`;
  const held = sql`${schema.gearHolds.id} IS NOT NULL`;
  const notHeld = sql`${schema.gearHolds.id} IS NULL`;
  const serviceable = eq(schema.gearItems.condition, "serviceable");
  const inCave = eq(schema.gearItems.whereabouts, "cave");
  switch (availability) {
    case "retired":
      return sql`${schema.gearItems.status} <> 'active'`;
    case "on_loan":
      return and(active, onLoan);
    case "unavailable":
      return and(
        active,
        notOnLoan,
        sql`(${schema.gearItems.condition} <> 'serviceable' OR ${schema.gearItems.whereabouts} <> 'cave')`,
      );
    case "on_hold":
      return and(active, notOnLoan, serviceable, inCave, held);
    case "available":
      return and(active, notOnLoan, serviceable, inCave, notHeld);
  }
}

export interface ListGearItemsResult {
  rows: GearItemRow[];
  total: number;
  page: number;
  perPage: number;
}

export async function listGearItems(
  options: ListGearItemOptions = {},
): Promise<ListGearItemsResult> {
  const db = getDb();
  const page = Math.max(1, options.page ?? DEFAULT_PAGE);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, options.perPage ?? DEFAULT_PER_PAGE),
  );
  const where = itemWhere(options);
  const sort = options.sort ?? "code";
  // Direction is the caller's now that the toolbar exposes it, but each
  // key keeps its own default so an unqualified `?sort=created_at` still
  // means newest-first rather than silently flipping to oldest.
  const dir =
    options.dir ?? (sort === "code" || sort === "model" ? "asc" : "desc");
  const order = dir === "asc" ? asc : desc;

  // Code is the only unique key here, so it needs no tiebreaker; the
  // other sorts fall back to it for a stable page boundary — and the
  // tiebreaker runs in the *same* direction, because two items created
  // in the same millisecond (a bulk import does this for every row)
  // would otherwise come back in ascending code order under a
  // descending sort.
  const orderBy =
    sort === "code"
      ? [order(schema.gearItems.code)]
      : sort === "model"
        ? [order(schema.gearModels.name), order(schema.gearItems.code)]
        : sort === "created_at"
          ? [order(schema.gearItems.createdAt), order(schema.gearItems.code)]
          : [order(schema.gearItems.updatedAt), order(schema.gearItems.code)];

  const rows = await itemsWithModelAndType()
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);

  // The count mirrors the row query's joins exactly. It must: the
  // availability filter and the free-text search both reference the
  // model, loan and hold tables, so a narrower count either fails on an
  // unknown column or reports a total the rows can't add up to.
  const now = sql`(unixepoch() * 1000)`;
  const totalRows = await db
    .select({ value: count() })
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
      schema.gearLoans,
      and(
        eq(schema.gearLoans.itemId, schema.gearItems.id),
        sql`${schema.gearLoans.returnedAt} IS NULL`,
      ),
    )
    .leftJoin(
      schema.gearHolds,
      sql`${schema.gearHolds.id} = (
        SELECT h.id FROM ${schema.gearHolds} h
        WHERE h.item_id = ${schema.gearItems.id}
          AND h.released_at IS NULL
          AND h.starts_at <= ${now}
          AND h.ends_at > ${now}
        ORDER BY h.ends_at ASC
        LIMIT 1
      )`,
    )
    .where(where);
  const total = totalRows[0]?.value ?? 0;

  return { rows, total, page, perPage };
}

export async function getGearItemByPublicId(
  publicId: string,
): Promise<GearItemRow | null> {
  const rows = await itemsWithModelAndType()
    .where(eq(schema.gearItems.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGearItemById(
  id: string,
): Promise<schema.GearItem | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearItems)
    .where(eq(schema.gearItems.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch tag assignments for the given item IDs. Returns a map keyed by
 * item ID. Callers merge into their `GearItemRow[]` themselves.
 */
export async function listTagsForItemIds(
  itemIds: string[],
  options: { includeInternal: boolean } = { includeInternal: true },
): Promise<Map<string, schema.GearTag[]>> {
  const map = new Map<string, schema.GearTag[]>();
  if (itemIds.length === 0) return map;
  const db = getDb();
  const where = options.includeInternal
    ? inArray(schema.gearTagAssignments.itemId, itemIds)
    : and(
        inArray(schema.gearTagAssignments.itemId, itemIds),
        eq(schema.gearTags.visibility, "public"),
      );
  const rows = await db
    .select({
      itemId: schema.gearTagAssignments.itemId,
      tag: schema.gearTags,
    })
    .from(schema.gearTagAssignments)
    .innerJoin(
      schema.gearTags,
      eq(schema.gearTags.id, schema.gearTagAssignments.tagId),
    )
    .where(where)
    .orderBy(asc(schema.gearTags.name));
  for (const row of rows) {
    const list = map.get(row.itemId) ?? [];
    list.push(row.tag);
    map.set(row.itemId, list);
  }
  return map;
}

export async function insertGearItem(input: {
  id: string;
  publicId: string;
  modelId: string;
  code: string | null;
  serialNumber: string | null;
  description: string | null;
  thumbnailKey: string | null;
  manufacturedAt: Temporal.Instant | null;
  acquiredAt: Temporal.Instant | null;
  acquisitionCostCents: number | null;
  acquisitionKind: schema.GearAcquisitionKind | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.gearItems).values({
    ...input,
    status: "active",
    whereabouts: input.whereabouts ?? "cave",
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateGearItemById(
  id: string,
  patch: Partial<{
    modelId: string;
    code: string | null;
    serialNumber: string | null;
    description: string | null;
    thumbnailKey: string | null;
    manufacturedAt: Temporal.Instant | null;
    acquiredAt: Temporal.Instant | null;
    acquisitionCostCents: number | null;
    acquisitionKind: schema.GearAcquisitionKind | null;
    notesMarkdown: string | null;
    condition: schema.GearCondition;
    whereabouts: schema.GearWhereabouts;
    whereaboutsAsOf: Temporal.Instant | null;
    whereaboutsNote: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gearItems)
    .set({ ...patch, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearItems.id, id));
}

/**
 * Move an item to a terminal status.
 *
 * **Deliberately does not touch `code`.** The old retire NULLed it to
 * free the string for reuse; codes are no longer recycled, so the label
 * stays bound to this item forever and every historical mention of
 * "CH93" resolves to exactly one thing. `releaseGearItemCode` is the
 * explicit way to free one.
 */
export async function markGearItemDeactivated(input: {
  id: string;
  status: Exclude<schema.GearStatus, "active">;
  deactivatedBy: string;
  reason: string | null;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db
    .update(schema.gearItems)
    .set({
      status: input.status,
      deactivatedAt: now,
      deactivatedBy: input.deactivatedBy,
      deactivatedReason: input.reason,
      updatedAt: now,
    })
    .where(eq(schema.gearItems.id, input.id));
}

/**
 * Undo a mis-click. **Preserves `deactivatedReason`** — the old
 * un-retire nulled it, which destroyed the record of why a harness was
 * pulled from service the moment someone reversed the decision. The
 * reason stays on the row until the next deactivation overwrites it, and
 * the reactivation itself is an audit event.
 */
export async function markGearItemReactivated(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gearItems)
    .set({
      status: "active",
      deactivatedAt: null,
      deactivatedBy: null,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.gearItems.id, id));
}

/**
 * Free a code from an already-deactivated item so it can be reissued.
 *
 * The whole of the code-recycling story: explicit, one item at a time,
 * audited by the caller with the prior value. Not a mode the system runs
 * in, which is what lets the UNIQUE index mean what it says.
 */
export async function releaseGearItemCode(id: string): Promise<void> {
  await getDb()
    .update(schema.gearItems)
    .set({ code: null, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearItems.id, id));
}

/**
 * Bulk variants for the toolbar-driven multi-select operations.
 * Drizzle's `where inArray(...)` translates to `WHERE id IN (...)`,
 * which D1 happily plans as a single round-trip. The caller computes
 * prior values (for audit metadata) BEFORE calling these — we don't
 * .returning() because that doubles the planner cost.
 */
export async function bulkMarkGearItemsDeactivated(input: {
  ids: string[];
  status: Exclude<schema.GearStatus, "active">;
  deactivatedBy: string;
  reason: string | null;
}): Promise<void> {
  const stmt = buildBulkDeactivateStatement(input);
  if (stmt) await stmt;
}

/**
 * Statement-builder variant. Returns the drizzle UPDATE builder (or
 * `null` when there's nothing to do) so the caller can compose it with
 * other writes in a single `db.batch`.
 */
export function buildBulkDeactivateStatement(input: {
  ids: string[];
  status: Exclude<schema.GearStatus, "active">;
  deactivatedBy: string;
  reason: string | null;
}) {
  if (input.ids.length === 0) return null;
  const now = Temporal.Now.instant();
  return getDb()
    .update(schema.gearItems)
    .set({
      status: input.status,
      deactivatedAt: now,
      deactivatedBy: input.deactivatedBy,
      deactivatedReason: input.reason,
      updatedAt: now,
    })
    .where(
      and(
        inArray(schema.gearItems.id, input.ids),
        eq(schema.gearItems.status, "active"),
      ),
    );
}

export async function bulkMarkGearItemsReactivated(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.gearItems)
    .set({
      status: "active",
      deactivatedAt: null,
      deactivatedBy: null,
      updatedAt: Temporal.Now.instant(),
    })
    .where(
      and(
        inArray(schema.gearItems.id, ids),
        sql`${schema.gearItems.status} <> 'active'`,
      ),
    );
}

export async function bulkSetGearItemCondition(input: {
  ids: string[];
  condition: schema.GearCondition;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.gearItems)
    .set({ condition: input.condition, updatedAt: Temporal.Now.instant() })
    .where(inArray(schema.gearItems.id, input.ids));
}

export async function bulkSetGearItemWhereabouts(input: {
  ids: string[];
  whereabouts: schema.GearWhereabouts;
  asOf: Temporal.Instant | null;
  note: string | null;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.gearItems)
    .set({
      whereabouts: input.whereabouts,
      whereaboutsAsOf: input.asOf,
      whereaboutsNote: input.note,
      updatedAt: Temporal.Now.instant(),
    })
    .where(inArray(schema.gearItems.id, input.ids));
}

/**
 * Add the given tags to every item in `itemIds`, leaving existing tag
 * assignments untouched. Uses `INSERT OR IGNORE` semantics via
 * Drizzle's `onConflictDoNothing` so duplicate (itemId, tagId) pairs
 * aren't an error — saves the caller from having to dedupe.
 */
export async function bulkAddGearItemTags(input: {
  itemIds: string[];
  tagIds: string[];
  assignedBy: string;
}): Promise<void> {
  if (input.itemIds.length === 0 || input.tagIds.length === 0) return;
  const now = Temporal.Now.instant();
  const rows = input.itemIds.flatMap((itemId) =>
    input.tagIds.map((tagId) => ({
      itemId,
      tagId,
      assignedAt: now,
      assignedBy: input.assignedBy,
    })),
  );
  await getDb()
    .insert(schema.gearTagAssignments)
    .values(rows)
    .onConflictDoNothing();
}

/**
 * Fetch label-ready rows for printing: items with their model and type
 * names joined. Returns rows whose `code` is non-null (an unlabelled
 * item has nothing scannable to print) in the order the publicIds were
 * supplied so the printed sheet matches the user's selection order.
 */
export interface GearLabelRow {
  publicId: string;
  code: string;
  description: string;
  typeName: string;
}

export async function getGearLabelsByPublicIds(
  publicIds: string[],
): Promise<GearLabelRow[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      publicId: schema.gearItems.publicId,
      code: schema.gearItems.code,
      description: schema.gearItems.description,
      modelName: schema.gearModels.name,
      typeName: schema.gearTypes.name,
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
    .where(inArray(schema.gearItems.publicId, publicIds));
  const byPublicId = new Map(rows.map((r) => [r.publicId, r]));
  return publicIds.flatMap((id) => {
    const row = byPublicId.get(id);
    if (!row || row.code === null) return [];
    return [
      {
        publicId: row.publicId,
        code: row.code,
        // The label wants the product, not the per-unit scribble: an
        // item's `description` is now optional and usually empty.
        description: row.description ?? row.modelName,
        typeName: row.typeName,
      },
    ];
  });
}

/**
 * Fetch the `id`, `code` and `status` for a set of item publicIds. Used
 * by bulk actions to translate client-supplied publicIds into internal
 * ids and to surface prior codes in the audit log.
 */
export async function getGearItemsByPublicIds(publicIds: string[]): Promise<
  Array<{
    id: string;
    publicId: string;
    code: string | null;
    status: schema.GearStatus;
  }>
> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: schema.gearItems.id,
      publicId: schema.gearItems.publicId,
      code: schema.gearItems.code,
      status: schema.gearItems.status,
    })
    .from(schema.gearItems)
    .where(inArray(schema.gearItems.publicId, publicIds));
}

// ── gear inspections ────────────────────────────────────────────────────

export interface GearInspectionRow {
  id: string;
  publicId: string;
  itemId: string | null;
  modelId: string | null;
  inspectorUserId: string | null;
  inspectorNameSnapshot: string | null;
  /** Profile.fullName joined at read time. Falls back to the snapshot
   *  when the inspector's profile or user row no longer exists. */
  inspectorDisplayName: string | null;
  inspectedAt: Temporal.Instant;
  result: schema.GearInspectionResult;
  notes: string | null;
  createdAt: Temporal.Instant;
}

export async function insertGearInspection(input: {
  id: string;
  publicId: string;
  itemId: string | null;
  modelId: string | null;
  inspectorUserId: string;
  inspectorNameSnapshot: string;
  inspectedAt: Temporal.Instant;
  result: schema.GearInspectionResult;
  notes: string | null;
}): Promise<void> {
  await getDb().insert(schema.gearInspections).values(input);
}

const INSPECTION_COLUMNS = {
  id: schema.gearInspections.id,
  publicId: schema.gearInspections.publicId,
  itemId: schema.gearInspections.itemId,
  modelId: schema.gearInspections.modelId,
  inspectorUserId: schema.gearInspections.inspectorUserId,
  inspectorNameSnapshot: schema.gearInspections.inspectorNameSnapshot,
  profileName: schema.profiles.fullName,
  inspectedAt: schema.gearInspections.inspectedAt,
  result: schema.gearInspections.result,
  notes: schema.gearInspections.notes,
  createdAt: schema.gearInspections.createdAt,
} as const;

function toInspectionRow(r: {
  id: string;
  publicId: string;
  itemId: string | null;
  modelId: string | null;
  inspectorUserId: string | null;
  inspectorNameSnapshot: string | null;
  profileName: string | null;
  inspectedAt: Temporal.Instant;
  result: schema.GearInspectionResult;
  notes: string | null;
  createdAt: Temporal.Instant;
}): GearInspectionRow {
  const { profileName, ...rest } = r;
  return {
    ...rest,
    inspectorDisplayName: profileName ?? r.inspectorNameSnapshot,
  };
}

export async function listInspectionsForItem(
  itemId: string,
): Promise<GearInspectionRow[]> {
  const rows = await getDb()
    .select(INSPECTION_COLUMNS)
    .from(schema.gearInspections)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearInspections.inspectorUserId),
    )
    .where(eq(schema.gearInspections.itemId, itemId))
    .orderBy(desc(schema.gearInspections.inspectedAt));
  return rows.map(toInspectionRow);
}

/** Counted models are inspected as a batch ("looked over all the draws"),
 *  so their history hangs off the model rather than any one unit. */
export async function listInspectionsForModel(
  modelId: string,
): Promise<GearInspectionRow[]> {
  const rows = await getDb()
    .select(INSPECTION_COLUMNS)
    .from(schema.gearInspections)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearInspections.inspectorUserId),
    )
    .where(eq(schema.gearInspections.modelId, modelId))
    .orderBy(desc(schema.gearInspections.inspectedAt));
  return rows.map(toInspectionRow);
}

/**
 * Latest inspection per item, for the due-for-inspection report and the
 * list-view badge. One query with a correlated MAX rather than N+1.
 */
export async function latestInspectionByItemIds(
  itemIds: string[],
): Promise<
  Map<
    string,
    { inspectedAt: Temporal.Instant; result: schema.GearInspectionResult }
  >
> {
  const map = new Map<
    string,
    { inspectedAt: Temporal.Instant; result: schema.GearInspectionResult }
  >();
  if (itemIds.length === 0) return map;
  const rows = await getDb()
    .select({
      itemId: schema.gearInspections.itemId,
      inspectedAt: schema.gearInspections.inspectedAt,
      result: schema.gearInspections.result,
    })
    .from(schema.gearInspections)
    .where(inArray(schema.gearInspections.itemId, itemIds))
    .orderBy(desc(schema.gearInspections.inspectedAt));
  for (const row of rows) {
    if (row.itemId === null || map.has(row.itemId)) continue;
    map.set(row.itemId, { inspectedAt: row.inspectedAt, result: row.result });
  }
  return map;
}

// ── gear types ──────────────────────────────────────────────────────────

export async function listGearTypes(): Promise<schema.GearType[]> {
  const db = getDb();
  return db.select().from(schema.gearTypes).orderBy(asc(schema.gearTypes.name));
}

export async function getGearTypeByPublicId(
  publicId: string,
): Promise<schema.GearType | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearTypes)
    .where(eq(schema.gearTypes.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGearTypeById(
  id: string,
): Promise<schema.GearType | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearTypes)
    .where(eq(schema.gearTypes.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGearTypesByPublicIds(
  publicIds: string[],
): Promise<schema.GearType[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(schema.gearTypes)
    .where(inArray(schema.gearTypes.publicId, publicIds));
}

export async function insertGearType(input: {
  id: string;
  publicId: string;
  name: string;
  prefix: string | null;
  description: string | null;
  inspectionIntervalDays: number | null;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db
    .insert(schema.gearTypes)
    .values({ ...input, createdAt: now, updatedAt: now });
}

export async function updateGearTypeById(
  id: string,
  patch: Partial<{
    name: string;
    prefix: string | null;
    description: string | null;
    inspectionIntervalDays: number | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gearTypes)
    .set({ ...patch, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearTypes.id, id));
}

export async function deleteGearTypeById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.gearTypes).where(eq(schema.gearTypes.id, id));
}

/** Models are RESTRICTed against type delete; the action layer pre-checks
 *  so it can return a typed error rather than let the FK throw. */
export async function countModelsForType(typeId: string): Promise<number> {
  const rows = await getDb()
    .select({ value: count() })
    .from(schema.gearModels)
    .where(eq(schema.gearModels.typeId, typeId));
  return rows[0]?.value ?? 0;
}

// ── gear tags ───────────────────────────────────────────────────────────

export async function listGearTags(
  options: { includeInternal: boolean } = { includeInternal: true },
): Promise<schema.GearTag[]> {
  const db = getDb();
  const q = db.select().from(schema.gearTags);
  const rows = options.includeInternal
    ? await q.orderBy(asc(schema.gearTags.name))
    : await q
        .where(eq(schema.gearTags.visibility, "public"))
        .orderBy(asc(schema.gearTags.name));
  return rows;
}

export async function getGearTagByPublicId(
  publicId: string,
): Promise<schema.GearTag | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearTags)
    .where(eq(schema.gearTags.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGearTagsByPublicIds(
  publicIds: string[],
): Promise<schema.GearTag[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(schema.gearTags)
    .where(inArray(schema.gearTags.publicId, publicIds));
}

export async function insertGearTag(input: {
  id: string;
  publicId: string;
  name: string;
  visibility: schema.GearTagVisibility;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db
    .insert(schema.gearTags)
    .values({ ...input, createdAt: now, updatedAt: now });
}

export async function deleteGearTagById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.gearTags).where(eq(schema.gearTags.id, id));
}

export async function getGearTagById(
  id: string,
): Promise<schema.GearTag | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearTags)
    .where(eq(schema.gearTags.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateGearTagById(
  id: string,
  patch: Partial<{ name: string; visibility: schema.GearTagVisibility }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gearTags)
    .set({ ...patch, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearTags.id, id));
}

/**
 * Replace the tag set for a single item. Computes the diff against the
 * current assignments so the caller can emit a focused
 * `gear.tags_changed` audit event without inspecting state twice.
 */
export async function setGearItemTags(input: {
  itemId: string;
  tagIds: string[];
  assignedBy: string;
}): Promise<{ added: string[]; removed: string[] }> {
  const db = getDb();
  const desired = new Set(input.tagIds);
  const current = await db
    .select({ tagId: schema.gearTagAssignments.tagId })
    .from(schema.gearTagAssignments)
    .where(eq(schema.gearTagAssignments.itemId, input.itemId));
  const currentIds = new Set(current.map((r) => r.tagId));
  const added = [...desired].filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !desired.has(id));
  if (removed.length > 0) {
    await db
      .delete(schema.gearTagAssignments)
      .where(
        and(
          eq(schema.gearTagAssignments.itemId, input.itemId),
          inArray(schema.gearTagAssignments.tagId, removed),
        ),
      );
  }
  if (added.length > 0) {
    const now = Temporal.Now.instant();
    await db.insert(schema.gearTagAssignments).values(
      added.map((tagId) => ({
        itemId: input.itemId,
        tagId,
        assignedAt: now,
        assignedBy: input.assignedBy,
      })),
    );
  }
  return { added, removed };
}

/**
 * Every code ever issued under one type, for the suggest-code helper.
 *
 * **Deliberately unfiltered by status.** This used to consider only
 * active gear, which was safe only because retiring NULLed the code.
 * Codes are no longer recycled, so a retired `CH93` still holds the
 * UNIQUE index — filtering it out here would make the app suggest a code
 * that its own constraint then rejects.
 */
export async function listCodesForType(typeId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ code: schema.gearItems.code })
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .where(
      and(
        eq(schema.gearModels.typeId, typeId),
        sql`${schema.gearItems.code} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.code).filter((c): c is string => c !== null);
}

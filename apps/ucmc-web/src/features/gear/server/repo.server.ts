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
import { DUE_SOON_DAYS, EXPIRING_SOON_DAYS } from "#/features/gear/lib/safety";
import { getDb, likeContains, schema } from "#/server/db";
import { gearItemName } from "#/features/gear/lib/labels";

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
  /** Inspection cadence, model overriding type. Both are carried
   *  rather than pre-resolved because the officer view wants to say
   *  which level the number came from. */
  modelInspectionIntervalDays: number | null;
  typeInspectionIntervalDays: number | null;
  /** Most recent inspection of this piece, joined in a correlated
   *  subquery rather than a second round-trip: the derived safety
   *  columns are on every row, so fetching them separately would mean
   *  a second query per page for something the sort needs anyway. */
  lastInspectedAt: Temporal.Instant | null;
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
  modelInspectionIntervalDays: schema.gearModels.inspectionIntervalDays,
  typeInspectionIntervalDays: schema.gearTypes.inspectionIntervalDays,
  lastInspectedAt: sql<number | null>`(
    SELECT max(i.inspected_at) FROM ${schema.gearInspections} i
    WHERE i.item_id = ${schema.gearItems.id}
  )`.mapWith(schema.gearInspections.inspectedAt),
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
  /** Facet filter, already resolved to ids and coerced to the storage
   *  columns by the action — the repo never sees a raw form string. */
  attributes?: AttributeFilter[];
  /** Derived safety backlogs. Pushed into SQL for the same reason
   *  availability is: filtering a fetched page returns short pages and
   *  a lying total. */
  inspection?: "overdue" | "due_soon" | "never";
  serviceLife?: "expired" | "expiring" | "unknown";
  q?: string;
}

/**
 * One facet: a definition and the values that satisfy it. Values within
 * a facet are OR'd (a member picking "M or L" means either), and
 * separate facets are AND'd (size M *and* dry-treated) — which is the
 * opposite of how the tag filter behaves, and deliberately so. A tag is
 * a label somebody chose to stick on; an attribute answers a fixed
 * question, so two values of the same question are alternatives.
 */
export interface AttributeFilter {
  defId: string;
  texts: string[];
  numbers: number[];
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
        likeContains(schema.gearItems.notesMarkdown, q),
        likeContains(schema.gearModels.name, q),
        likeContains(schema.gearModels.manufacturer, q),
      ),
    );
  }
  if (filters.inspection) {
    clauses.push(inspectionWhere(filters.inspection));
  }
  if (filters.serviceLife) {
    clauses.push(serviceLifeWhere(filters.serviceLife));
  }
  for (const facet of filters.attributes ?? []) {
    const match = attributeValueMatch(facet);
    if (match === null) {
      continue;
    }
    // Both levels are checked because the repo is not told which one
    // the definition lives at, and a def only ever has rows in its own
    // level's table — so the union is exact, not a guess.
    clauses.push(
      sql`(
        EXISTS (
          SELECT 1 FROM ${schema.gearItemAttributeValues} iv
          WHERE iv.item_id = ${schema.gearItems.id}
            AND iv.def_id = ${facet.defId}
            AND ${match}
        )
        OR EXISTS (
          SELECT 1 FROM ${schema.gearModelAttributeValues} mv
          WHERE mv.model_id = ${schema.gearItems.modelId}
            AND mv.def_id = ${facet.defId}
            AND ${match}
        )
      )`,
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

/** The cadence in force for a row: the model's, else the type's. */
const EFFECTIVE_INTERVAL = sql`coalesce(${schema.gearModels.inspectionIntervalDays}, ${schema.gearTypes.inspectionIntervalDays})`;

const LAST_INSPECTED = sql`(
  SELECT max(i.inspected_at) FROM ${schema.gearInspections} i
  WHERE i.item_id = ${schema.gearItems.id}
)`;

/**
 * SQL mirror of `inspectionState`, and subject to the same
 * keep-in-step rule as `availabilityWhere`.
 *
 * The one place the two can disagree: this does the arithmetic in
 * milliseconds while `inspectionState` counts whole club-time calendar
 * days. They differ only for a piece whose inspection timestamp falls
 * within the UTC offset of midnight *and* whose due date straddles a
 * DST change — a row that would read one day early or late in the
 * filter while its badge says otherwise. Counting calendar days in SQL
 * would mean reimplementing club-time date math in SQLite, which is a
 * worse trade than a documented one-day edge on a backlog list.
 */
function inspectionWhere(filter: "overdue" | "due_soon" | "never") {
  const tracked = sql`${EFFECTIVE_INTERVAL} IS NOT NULL`;
  const dueAt = sql`${LAST_INSPECTED} + ${EFFECTIVE_INTERVAL} * 86400000`;
  const now = sql`(unixepoch() * 1000)`;
  switch (filter) {
    case "never":
      // Its own filter, not a flavour of overdue: a piece nobody has
      // ever looked at and one a week late are different jobs.
      return and(tracked, sql`${LAST_INSPECTED} IS NULL`);
    case "overdue":
      return and(
        tracked,
        sql`${LAST_INSPECTED} IS NOT NULL`,
        sql`${dueAt} < ${now}`,
      );
    case "due_soon":
      return and(
        tracked,
        sql`${LAST_INSPECTED} IS NOT NULL`,
        sql`${dueAt} >= ${now}`,
        sql`${dueAt} <= ${now} + ${DUE_SOON_DAYS} * 86400000`,
      );
  }
}

/**
 * SQL mirror of `serviceLifeState`. Calendar years are done by SQLite's
 * own date functions rather than an approximation in milliseconds,
 * because a leap day inside a ten-year life is a real day and "+10
 * years" is exactly what the manufacturer means.
 *
 * Carries the same class of drift `inspectionWhere` documents, for the
 * same reason: SQLite's `date()` works in UTC while `serviceLifeState`
 * counts club-time calendar days, so a piece whose expiry falls within
 * the UTC offset of midnight can land on either side of the boundary
 * for one day. Reimplementing club-time date math in SQLite is the
 * worse trade.
 */
function serviceLifeWhere(filter: "expired" | "expiring" | "unknown") {
  const tracked = sql`${schema.gearModels.serviceLifeYears} IS NOT NULL`;
  const expiresAt = sql`(
    unixepoch(date(${schema.gearItems.manufacturedAt} / 1000, 'unixepoch',
      '+' || ${schema.gearModels.serviceLifeYears} || ' years')) * 1000
  )`;
  const now = sql`(unixepoch() * 1000)`;
  switch (filter) {
    case "unknown":
      // The model ages out but nobody read the date off the tag. A gap
      // somebody can close, so it must not look like "doesn't apply".
      return and(tracked, sql`${schema.gearItems.manufacturedAt} IS NULL`);
    case "expired":
      return and(
        tracked,
        sql`${schema.gearItems.manufacturedAt} IS NOT NULL`,
        sql`${expiresAt} < ${now}`,
      );
    case "expiring":
      return and(
        tracked,
        sql`${schema.gearItems.manufacturedAt} IS NOT NULL`,
        sql`${expiresAt} >= ${now}`,
        sql`${expiresAt} <= ${now} + ${EXPIRING_SOON_DAYS} * 86400000`,
      );
  }
}

/**
 * The value test inside a facet's EXISTS, written once so the item and
 * model halves can't drift. Column names are bare because the caller
 * aliases both tables to `iv` / `mv` — and identical bare names is
 * precisely why one fragment can serve both.
 */
function attributeValueMatch(facet: AttributeFilter) {
  const parts = [];
  if (facet.texts.length > 0) {
    // Each value gets its own placeholder: handing drizzle the array
    // whole binds one array-shaped parameter, which SQLite rejects.
    parts.push(
      sql`value_text IN (${sql.join(
        facet.texts.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  }
  if (facet.numbers.length > 0) {
    parts.push(
      sql`value_number IN (${sql.join(
        facet.numbers.map((n) => sql`${n}`),
        sql`, `,
      )})`,
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * SQL mirror of `gearAvailability`. The two must agree: this decides
 * which rows come back, that decides what each one is labelled, and a
 * disagreement shows up as an item filtered to "Available" wearing an
 * "On loan" badge. Kept adjacent and in the same precedence order so a
 * change to one is an obvious prompt to change the other.
 */
export function availabilityWhere(availability: GearAvailability) {
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
  // SQLite sorts NULLs first ascending, so an untagged piece led the
  // default "Code, A → Z" list — the one row with no code at the top of
  // a list sorted by code. Uncoded pieces go last in either direction:
  // they are the exception, and they are what the officer is least
  // likely to be scanning for.
  const codeOrder = [
    sql`${schema.gearItems.code} is null`,
    order(schema.gearItems.code),
  ];
  const orderBy =
    sort === "code"
      ? codeOrder
      : sort === "model"
        ? [order(schema.gearModels.name), ...codeOrder]
        : sort === "created_at"
          ? [order(schema.gearItems.createdAt), ...codeOrder]
          : [order(schema.gearItems.updatedAt), ...codeOrder];

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

/**
 * Lookup by the code on the tag. Distinct from the desk's code search
 * in `loans-repo`: that one gates on `gear:loan` and carries loan
 * state, this is the plain "which item is CH93" every officer surface
 * needs. Case-insensitive, because nobody types the tag exactly.
 */
export async function getGearItemByCode(
  code: string,
): Promise<GearItemRow | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const rows = await itemsWithModelAndType()
    .where(sql`upper(${schema.gearItems.code}) = upper(${trimmed})`)
    .limit(1);
  return rows.at(0) ?? null;
}

export async function insertGearItem(input: {
  id: string;
  publicId: string;
  modelId: string;
  code: string | null;
  serialNumber: string | null;
  thumbnailKey: string | null;
  manufacturedAt: Temporal.Instant | null;
  acquiredAt: Temporal.Instant | null;
  acquisitionCostCents: number | null;
  acquisitionKind: schema.GearAcquisitionKind | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  whereabouts?: schema.GearWhereabouts;
  whereaboutsNote?: string | null;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  const whereabouts = input.whereabouts ?? "cave";
  await db.insert(schema.gearItems).values({
    ...input,
    status: "active",
    whereabouts,
    whereaboutsNote: input.whereaboutsNote ?? null,
    // Same stamp `updateGearItemById`'s callers apply: `missing` is the
    // one state that means "unseen since", so it needs a since.
    whereaboutsAsOf: whereabouts === "missing" ? now : null,
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
  name: string;
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
      modelName: schema.gearModels.name,
      manufacturer: schema.gearModels.manufacturer,
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
        name: gearItemName({
          manufacturer: row.manufacturer,
          name: row.modelName,
        }),
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

/** The same read aimed at `model_id`: a counted model's inspection
 *  clock runs off the newest batch check, there being no units to ask. */
export async function latestInspectionByModelIds(
  modelIds: string[],
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
  if (modelIds.length === 0) return map;
  const rows = await getDb()
    .select({
      modelId: schema.gearInspections.modelId,
      inspectedAt: schema.gearInspections.inspectedAt,
      result: schema.gearInspections.result,
    })
    .from(schema.gearInspections)
    .where(inArray(schema.gearInspections.modelId, modelIds))
    .orderBy(desc(schema.gearInspections.inspectedAt));
  for (const row of rows) {
    if (row.modelId === null || map.has(row.modelId)) continue;
    map.set(row.modelId, { inspectedAt: row.inspectedAt, result: row.result });
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

// ── browse by model ────────────────────────────────────────────────────

/**
 * One row per model, with its units bucketed by availability.
 *
 * This is the query the old flat list could not express, and the
 * reason the model layer exists: "7 of 12 available" is the answer a
 * member wants, and twelve unrelated rows saying "Black Diamond
 * HotForge" cannot give it.
 *
 * Counts are computed with the **same** `availabilityWhere` predicates
 * the item list filters by, summed as CASE expressions over the same
 * joins. That is deliberate — a fourth hand-written copy of the
 * precedence would be a fourth thing to keep in step.
 */
export interface GearModelBrowseRow {
  modelId: string;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  tracking: schema.GearTracking;
  imageKey: string | null;
  typePublicId: string;
  typeName: string;
  total: number;
  available: number;
  /** `available` minus the untagged — what the desk could actually hand
   *  over. See the column comment in `listGearModelBrowseRows`. */
  availableTakeable: number;
  onLoan: number;
  onHold: number;
  unavailable: number;
  retired: number;
}

export interface ListGearModelBrowseOptions {
  typeId?: string;
  q?: string;
}

export async function listGearModelBrowseRows(
  options: ListGearModelBrowseOptions = {},
): Promise<GearModelBrowseRow[]> {
  const now = sql`(unixepoch() * 1000)`;
  const bucket = (availability: GearAvailability) =>
    sql<number>`sum(case when ${availabilityWhere(availability)} then 1 else 0 end)`;

  const clauses = [] as Parameters<typeof and>;
  if (options.typeId) {
    clauses.push(eq(schema.gearModels.typeId, options.typeId));
  }
  if (options.q && options.q.trim().length > 0) {
    const q = options.q.trim();
    clauses.push(
      or(
        likeContains(schema.gearModels.name, q),
        likeContains(schema.gearModels.manufacturer, q),
        likeContains(schema.gearTypes.name, q),
      ),
    );
  }

  const rows = await getDb()
    .select({
      modelId: schema.gearModels.id,
      modelPublicId: schema.gearModels.publicId,
      modelName: schema.gearModels.name,
      manufacturer: schema.gearModels.manufacturer,
      tracking: schema.gearModels.tracking,
      imageKey: schema.gearModels.imageKey,
      typePublicId: schema.gearTypes.publicId,
      typeName: schema.gearTypes.name,
      // A LEFT JOIN from the model side, so a model with no units yet
      // still appears — a counted model has none by definition, and a
      // coded one the cave has defined but not stocked is a real
      // intermediate state during setup.
      total: sql<number>`sum(case when ${schema.gearItems.id} is not null then 1 else 0 end)`,
      available: bucket("available"),
      // What a member could actually walk out with, which is `available`
      // minus the untagged. An uncoded piece is genuinely available in
      // the rollup's sense — active, serviceable, in the cave, nobody
      // has it — and the item list is right to say so. But the desk
      // cannot scan it out, so counting it under "1 of 2 available"
      // promised a harness that would be refused on arrival.
      availableTakeable: sql<number>`sum(case when ${availabilityWhere(
        "available",
      )} and ${schema.gearItems.code} is not null then 1 else 0 end)`,
      onLoan: bucket("on_loan"),
      onHold: bucket("on_hold"),
      unavailable: bucket("unavailable"),
      retired: bucket("retired"),
    })
    .from(schema.gearModels)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.modelId, schema.gearModels.id),
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
    .where(clauses.length === 0 ? undefined : and(...clauses))
    .groupBy(schema.gearModels.id)
    .orderBy(asc(schema.gearTypes.name), asc(schema.gearModels.name));

  return rows.map((row) => ({
    ...row,
    total: Number(row.total),
    available: Number(row.available),
    availableTakeable: Number(row.availableTakeable),
    onLoan: Number(row.onLoan),
    onHold: Number(row.onHold),
    unavailable: Number(row.unavailable),
    retired: Number(row.retired),
  }));
}

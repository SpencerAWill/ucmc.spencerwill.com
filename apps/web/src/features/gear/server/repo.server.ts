/**
 * Pure data access for gear inventory. No auth, no business logic — the
 * action modules are responsible for authorization and audit emission.
 *
 * Tag joins are handled with a second query rather than SQL aggregation:
 * after the gear page is loaded we fetch every tag assignment for the
 * matching gear IDs and merge in TypeScript. Two D1 round-trips total
 * per list request, but the shape is straightforward and easy to test.
 */
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface GearRow {
  id: string;
  publicId: string;
  typeId: string;
  code: string | null;
  description: string;
  thumbnailKey: string | null;
  acquiredAt: Date | null;
  acquisitionCostCents: number | null;
  notesMarkdown: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  retiredAt: Date | null;
  retiredReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  typePublicId: string;
  typeName: string;
  typePrefix: string | null;
}

export interface ListGearFilters {
  typeId?: string;
  tagIds?: string[];
  lifecycle?: schema.GearLifecycle;
  condition?: schema.GearCondition;
  q?: string;
}

export interface ListGearOptions extends ListGearFilters {
  sort?: "code" | "created_at" | "updated_at";
  page?: number;
  perPage?: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 250;

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function gearWhere(filters: ListGearFilters) {
  const clauses = [] as Parameters<typeof and>;
  if (filters.typeId) {
    clauses.push(eq(schema.gear.typeId, filters.typeId));
  }
  if (filters.lifecycle) {
    clauses.push(eq(schema.gear.lifecycle, filters.lifecycle));
  }
  if (filters.condition) {
    clauses.push(eq(schema.gear.condition, filters.condition));
  }
  if (filters.q && filters.q.trim().length > 0) {
    const needle = `%${escapeLike(filters.q.trim())}%`;
    clauses.push(
      or(
        like(schema.gear.code, needle),
        like(schema.gear.description, needle),
        like(schema.gear.notesMarkdown, needle),
      ),
    );
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const tagIds = filters.tagIds;
    clauses.push(
      sql`${schema.gear.id} IN (
        SELECT ${schema.gearTagAssignments.gearId}
        FROM ${schema.gearTagAssignments}
        WHERE ${inArray(schema.gearTagAssignments.tagId, tagIds)}
        GROUP BY ${schema.gearTagAssignments.gearId}
        HAVING COUNT(DISTINCT ${schema.gearTagAssignments.tagId}) = ${tagIds.length}
      )`,
    );
  }
  return clauses.length === 0 ? undefined : and(...clauses);
}

export interface ListGearResult {
  rows: GearRow[];
  total: number;
  page: number;
  perPage: number;
}

export async function listGear(
  options: ListGearOptions = {},
): Promise<ListGearResult> {
  const db = getDb();
  const page = Math.max(1, options.page ?? DEFAULT_PAGE);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, options.perPage ?? DEFAULT_PER_PAGE),
  );
  const where = gearWhere(options);
  const sort = options.sort ?? "code";

  const orderBy =
    sort === "code"
      ? [asc(schema.gear.code), desc(schema.gear.createdAt)]
      : sort === "created_at"
        ? [desc(schema.gear.createdAt)]
        : [desc(schema.gear.updatedAt)];

  const rows = await db
    .select({
      id: schema.gear.id,
      publicId: schema.gear.publicId,
      typeId: schema.gear.typeId,
      code: schema.gear.code,
      description: schema.gear.description,
      thumbnailKey: schema.gear.thumbnailKey,
      acquiredAt: schema.gear.acquiredAt,
      acquisitionCostCents: schema.gear.acquisitionCostCents,
      notesMarkdown: schema.gear.notesMarkdown,
      lifecycle: schema.gear.lifecycle,
      condition: schema.gear.condition,
      retiredAt: schema.gear.retiredAt,
      retiredReason: schema.gear.retiredReason,
      createdAt: schema.gear.createdAt,
      updatedAt: schema.gear.updatedAt,
      typePublicId: schema.gearTypes.publicId,
      typeName: schema.gearTypes.name,
      typePrefix: schema.gearTypes.prefix,
    })
    .from(schema.gear)
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);

  const totalRows = await db
    .select({ value: count() })
    .from(schema.gear)
    .where(where);
  const total = totalRows[0]?.value ?? 0;

  return { rows, total, page, perPage };
}

export async function getGearByPublicId(
  publicId: string,
): Promise<GearRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gear.id,
      publicId: schema.gear.publicId,
      typeId: schema.gear.typeId,
      code: schema.gear.code,
      description: schema.gear.description,
      thumbnailKey: schema.gear.thumbnailKey,
      acquiredAt: schema.gear.acquiredAt,
      acquisitionCostCents: schema.gear.acquisitionCostCents,
      notesMarkdown: schema.gear.notesMarkdown,
      lifecycle: schema.gear.lifecycle,
      condition: schema.gear.condition,
      retiredAt: schema.gear.retiredAt,
      retiredReason: schema.gear.retiredReason,
      createdAt: schema.gear.createdAt,
      updatedAt: schema.gear.updatedAt,
      typePublicId: schema.gearTypes.publicId,
      typeName: schema.gearTypes.name,
      typePrefix: schema.gearTypes.prefix,
    })
    .from(schema.gear)
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .where(eq(schema.gear.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGearById(id: string): Promise<schema.Gear | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gear)
    .where(eq(schema.gear.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch tag assignments for the given gear IDs. Returns a map keyed by
 * gear ID. Callers merge into their `GearRow[]` themselves.
 */
export async function listTagsForGearIds(
  gearIds: string[],
  options: { includeInternal: boolean } = { includeInternal: true },
): Promise<Map<string, schema.GearTag[]>> {
  const map = new Map<string, schema.GearTag[]>();
  if (gearIds.length === 0) return map;
  const db = getDb();
  const where = options.includeInternal
    ? inArray(schema.gearTagAssignments.gearId, gearIds)
    : and(
        inArray(schema.gearTagAssignments.gearId, gearIds),
        eq(schema.gearTags.visibility, "public"),
      );
  const rows = await db
    .select({
      gearId: schema.gearTagAssignments.gearId,
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
    const list = map.get(row.gearId) ?? [];
    list.push(row.tag);
    map.set(row.gearId, list);
  }
  return map;
}

export async function insertGear(input: {
  id: string;
  publicId: string;
  typeId: string;
  code: string | null;
  description: string;
  thumbnailKey: string | null;
  acquiredAt: Date | null;
  acquisitionCostCents: number | null;
  notesMarkdown: string | null;
  condition: schema.GearCondition;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.insert(schema.gear).values({
    id: input.id,
    publicId: input.publicId,
    typeId: input.typeId,
    code: input.code,
    description: input.description,
    thumbnailKey: input.thumbnailKey,
    acquiredAt: input.acquiredAt,
    acquisitionCostCents: input.acquisitionCostCents,
    notesMarkdown: input.notesMarkdown,
    lifecycle: "active",
    condition: input.condition,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateGearById(
  id: string,
  patch: Partial<{
    typeId: string;
    code: string | null;
    description: string;
    thumbnailKey: string | null;
    acquiredAt: Date | null;
    acquisitionCostCents: number | null;
    notesMarkdown: string | null;
    condition: schema.GearCondition;
  }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gear)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.gear.id, id));
}

export async function markGearRetired(input: {
  id: string;
  retiredBy: string;
  reason: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.gear)
    .set({
      lifecycle: "retired",
      code: null,
      retiredAt: now,
      retiredBy: input.retiredBy,
      retiredReason: input.reason,
      updatedAt: now,
    })
    .where(eq(schema.gear.id, input.id));
}

export async function markGearUnretired(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gear)
    .set({
      lifecycle: "active",
      retiredAt: null,
      retiredBy: null,
      retiredReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.gear.id, id));
}

/**
 * Bulk variants for the toolbar-driven multi-select operations.
 * Drizzle's `where inArray(...)` translates to `WHERE id IN (...)`,
 * which D1 happily plans as a single round-trip. The caller computes
 * prior values (for audit metadata) BEFORE calling these — we don't
 * .returning() because that doubles the planner cost.
 */
export async function bulkMarkGearRetired(input: {
  ids: string[];
  retiredBy: string;
  reason: string | null;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.gear)
    .set({
      lifecycle: "retired",
      code: null,
      retiredAt: now,
      retiredBy: input.retiredBy,
      retiredReason: input.reason,
      updatedAt: now,
    })
    .where(
      and(
        inArray(schema.gear.id, input.ids),
        eq(schema.gear.lifecycle, "active"),
      ),
    );
}

export async function bulkMarkGearUnretired(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.gear)
    .set({
      lifecycle: "active",
      retiredAt: null,
      retiredBy: null,
      retiredReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(inArray(schema.gear.id, ids), eq(schema.gear.lifecycle, "retired")),
    );
}

export async function bulkSetGearCondition(input: {
  ids: string[];
  condition: schema.GearCondition;
}): Promise<void> {
  if (input.ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.gear)
    .set({ condition: input.condition, updatedAt: new Date() })
    .where(inArray(schema.gear.id, input.ids));
}

/**
 * Add the given tags to every gear in `gearIds`, leaving existing tag
 * assignments untouched. Uses `INSERT OR IGNORE` semantics via
 * Drizzle's `onConflictDoNothing` so duplicate (gearId, tagId) pairs
 * aren't an error — saves the caller from having to dedupe.
 */
export async function bulkAddGearTags(input: {
  gearIds: string[];
  tagIds: string[];
  assignedBy: string;
}): Promise<void> {
  if (input.gearIds.length === 0 || input.tagIds.length === 0) return;
  const now = new Date();
  const rows = input.gearIds.flatMap((gearId) =>
    input.tagIds.map((tagId) => ({
      gearId,
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
 * Fetch the `id` and `code` for a set of gear publicIds. Used by bulk
 * actions to translate the client-supplied publicIds into internal
 * ids and to surface prior codes in the audit log.
 */
export async function getGearByPublicIds(publicIds: string[]): Promise<
  Array<{
    id: string;
    publicId: string;
    code: string | null;
    lifecycle: schema.GearLifecycle;
  }>
> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: schema.gear.id,
      publicId: schema.gear.publicId,
      code: schema.gear.code,
      lifecycle: schema.gear.lifecycle,
    })
    .from(schema.gear)
    .where(inArray(schema.gear.publicId, publicIds));
}

// ── gear inspections ────────────────────────────────────────────────────

export interface GearInspectionRow {
  id: string;
  publicId: string;
  gearId: string;
  inspectorUserId: string | null;
  inspectorNameSnapshot: string | null;
  /** Profile.fullName joined at read time. Falls back to the snapshot
   *  when the inspector's profile or user row no longer exists. */
  inspectorDisplayName: string | null;
  inspectedAt: Date;
  result: schema.GearInspectionResult;
  notes: string | null;
  createdAt: Date;
}

export async function insertGearInspection(input: {
  id: string;
  publicId: string;
  gearId: string;
  inspectorUserId: string;
  inspectorNameSnapshot: string;
  inspectedAt: Date;
  result: schema.GearInspectionResult;
  notes: string | null;
}): Promise<void> {
  await getDb().insert(schema.gearInspections).values({
    id: input.id,
    publicId: input.publicId,
    gearId: input.gearId,
    inspectorUserId: input.inspectorUserId,
    inspectorNameSnapshot: input.inspectorNameSnapshot,
    inspectedAt: input.inspectedAt,
    result: input.result,
    notes: input.notes,
  });
}

export async function listInspectionsForGear(
  gearId: string,
): Promise<GearInspectionRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gearInspections.id,
      publicId: schema.gearInspections.publicId,
      gearId: schema.gearInspections.gearId,
      inspectorUserId: schema.gearInspections.inspectorUserId,
      inspectorNameSnapshot: schema.gearInspections.inspectorNameSnapshot,
      profileName: schema.profiles.fullName,
      inspectedAt: schema.gearInspections.inspectedAt,
      result: schema.gearInspections.result,
      notes: schema.gearInspections.notes,
      createdAt: schema.gearInspections.createdAt,
    })
    .from(schema.gearInspections)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearInspections.inspectorUserId),
    )
    .where(eq(schema.gearInspections.gearId, gearId))
    .orderBy(desc(schema.gearInspections.inspectedAt));
  return rows.map((r) => ({
    id: r.id,
    publicId: r.publicId,
    gearId: r.gearId,
    inspectorUserId: r.inspectorUserId,
    inspectorNameSnapshot: r.inspectorNameSnapshot,
    inspectorDisplayName: r.profileName ?? r.inspectorNameSnapshot,
    inspectedAt: r.inspectedAt,
    result: r.result,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
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

export async function insertGearType(input: {
  id: string;
  publicId: string;
  name: string;
  prefix: string | null;
  description: string | null;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.insert(schema.gearTypes).values({
    id: input.id,
    publicId: input.publicId,
    name: input.name,
    prefix: input.prefix,
    description: input.description,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateGearTypeById(
  id: string,
  patch: Partial<{
    name: string;
    prefix: string | null;
    description: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.gearTypes)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.gearTypes.id, id));
}

export async function deleteGearTypeById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.gearTypes).where(eq(schema.gearTypes.id, id));
}

// ── gear tags ───────────────────────────────────────────────────────────

export async function listGearTags(
  options: { includeInternal: boolean } = { includeInternal: true },
): Promise<schema.GearTag[]> {
  const db = getDb();
  const query = db.select().from(schema.gearTags);
  if (!options.includeInternal) {
    return query
      .where(eq(schema.gearTags.visibility, "public"))
      .orderBy(asc(schema.gearTags.name));
  }
  return query.orderBy(asc(schema.gearTags.name));
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
  const now = new Date();
  await db.insert(schema.gearTags).values({
    id: input.id,
    publicId: input.publicId,
    name: input.name,
    visibility: input.visibility,
    createdAt: now,
    updatedAt: now,
  });
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
    .set({ name: patch.name, updatedAt: new Date() })
    .where(eq(schema.gearTags.id, id));
}

/**
 * Replace the tag set for a single gear row. Computes the diff against
 * the current assignments so the caller can emit a focused
 * `gear.tags_changed` audit event without inspecting state twice.
 */
export async function setGearTags(input: {
  gearId: string;
  tagIds: string[];
  assignedBy: string;
}): Promise<{ added: string[]; removed: string[] }> {
  const db = getDb();
  const desired = new Set(input.tagIds);
  const current = await db
    .select({ tagId: schema.gearTagAssignments.tagId })
    .from(schema.gearTagAssignments)
    .where(eq(schema.gearTagAssignments.gearId, input.gearId));
  const currentIds = new Set(current.map((r) => r.tagId));
  const added = [...desired].filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !desired.has(id));
  if (removed.length > 0) {
    await db
      .delete(schema.gearTagAssignments)
      .where(
        and(
          eq(schema.gearTagAssignments.gearId, input.gearId),
          inArray(schema.gearTagAssignments.tagId, removed),
        ),
      );
  }
  if (added.length > 0) {
    const now = new Date();
    await db.insert(schema.gearTagAssignments).values(
      added.map((tagId) => ({
        gearId: input.gearId,
        tagId,
        assignedAt: now,
        assignedBy: input.assignedBy,
      })),
    );
  }
  return { added, removed };
}

/**
 * Existing codes for one type (for the suggest-code UI helper).
 * Returns just the strings; the helper does the suffix math.
 */
export async function listActiveCodesForType(
  typeId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ code: schema.gear.code })
    .from(schema.gear)
    .where(
      and(
        eq(schema.gear.typeId, typeId),
        eq(schema.gear.lifecycle, "active"),
        sql`${schema.gear.code} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.code).filter((c): c is string => c !== null);
}

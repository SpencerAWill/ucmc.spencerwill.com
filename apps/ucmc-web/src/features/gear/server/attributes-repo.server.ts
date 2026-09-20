/**
 * Pure data access for attribute definitions and the values answering
 * them. No auth, no audit — `attributes-actions.server.ts` owns both.
 *
 * Definitions and their type attachments are read as two queries and
 * merged in TypeScript, the same shape the tag joins use: there are
 * tens of definitions, not thousands, and a GROUP_CONCAT would buy
 * nothing but a parsing step.
 *
 * Values are stored across two columns — `value_text` and
 * `value_number` — and which one a kind uses is decided once, in
 * `coerceAttributeValue`. This module writes whatever it is handed.
 */
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface GearAttributeDefRow {
  id: string;
  publicId: string;
  key: string;
  label: string;
  kind: schema.GearAttributeKind;
  level: schema.GearAttributeLevel;
  options: string[] | null;
  unit: string | null;
  required: boolean;
  position: number;
  archivedAt: Temporal.Instant | null;
  /** Both ids: actions need the public one for the wire, the filter
   *  paths need the internal one. */
  types: { id: string; publicId: string }[];
}

const DEF_COLUMNS = {
  id: schema.gearAttributeDefs.id,
  publicId: schema.gearAttributeDefs.publicId,
  key: schema.gearAttributeDefs.key,
  label: schema.gearAttributeDefs.label,
  kind: schema.gearAttributeDefs.kind,
  level: schema.gearAttributeDefs.level,
  options: schema.gearAttributeDefs.options,
  unit: schema.gearAttributeDefs.unit,
  required: schema.gearAttributeDefs.required,
  position: schema.gearAttributeDefs.position,
  archivedAt: schema.gearAttributeDefs.archivedAt,
} as const;

async function attachTypes(
  rows: Omit<GearAttributeDefRow, "types">[],
): Promise<GearAttributeDefRow[]> {
  if (rows.length === 0) {
    return [];
  }
  const links = await getDb()
    .select({
      defId: schema.gearAttributeDefTypes.defId,
      typeId: schema.gearTypes.id,
      typePublicId: schema.gearTypes.publicId,
    })
    .from(schema.gearAttributeDefTypes)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearAttributeDefTypes.typeId),
    )
    .where(
      inArray(
        schema.gearAttributeDefTypes.defId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(schema.gearTypes.name));
  const byDef = new Map<string, { id: string; publicId: string }[]>();
  for (const link of links) {
    const entry = { id: link.typeId, publicId: link.typePublicId };
    const existing = byDef.get(link.defId);
    if (existing) {
      existing.push(entry);
    } else {
      byDef.set(link.defId, [entry]);
    }
  }
  return rows.map((r) => ({ ...r, types: byDef.get(r.id) ?? [] }));
}

export interface ListGearAttributeDefsOptions {
  /** Archived defs are excluded by default: the forms must not offer
   *  them, and only the manage dialog has a reason to see them. */
  includeArchived?: boolean;
  /** Restrict to defs attached to one type — what every form and facet
   *  actually wants, since the type is already chosen by then. */
  typeId?: string;
  level?: schema.GearAttributeLevel;
}

export async function listGearAttributeDefs(
  options: ListGearAttributeDefsOptions = {},
): Promise<GearAttributeDefRow[]> {
  const clauses = [] as Parameters<typeof and>;
  if (!options.includeArchived) {
    clauses.push(isNull(schema.gearAttributeDefs.archivedAt));
  }
  if (options.level) {
    clauses.push(eq(schema.gearAttributeDefs.level, options.level));
  }
  if (options.typeId) {
    clauses.push(
      sql`${schema.gearAttributeDefs.id} IN (
        SELECT ${schema.gearAttributeDefTypes.defId}
        FROM ${schema.gearAttributeDefTypes}
        WHERE ${eq(schema.gearAttributeDefTypes.typeId, options.typeId)}
      )`,
    );
  }
  const rows = await getDb()
    .select(DEF_COLUMNS)
    .from(schema.gearAttributeDefs)
    // Position first, label as the tiebreaker: position defaults to 0
    // for everything, so without the second key a fresh install orders
    // by insertion accident.
    .where(clauses.length === 0 ? undefined : and(...clauses))
    .orderBy(
      asc(schema.gearAttributeDefs.position),
      asc(schema.gearAttributeDefs.label),
    );
  return attachTypes(rows);
}

export async function getGearAttributeDefByPublicId(
  publicId: string,
): Promise<GearAttributeDefRow | null> {
  const rows = await getDb()
    .select(DEF_COLUMNS)
    .from(schema.gearAttributeDefs)
    .where(eq(schema.gearAttributeDefs.publicId, publicId))
    .limit(1);
  const withTypes = await attachTypes(rows);
  return withTypes[0] ?? null;
}

export async function insertGearAttributeDef(input: {
  id: string;
  publicId: string;
  key: string;
  label: string;
  kind: schema.GearAttributeKind;
  level: schema.GearAttributeLevel;
  options: string[] | null;
  unit: string | null;
  required: boolean;
  position: number;
}): Promise<void> {
  await getDb().insert(schema.gearAttributeDefs).values(input);
}

export async function updateGearAttributeDefById(
  id: string,
  patch: Partial<{
    label: string;
    options: string[] | null;
    unit: string | null;
    required: boolean;
    position: number;
    archivedAt: Temporal.Instant | null;
  }>,
): Promise<void> {
  await getDb()
    .update(schema.gearAttributeDefs)
    .set({ ...patch, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.gearAttributeDefs.id, id));
}

export async function deleteGearAttributeDefById(id: string): Promise<void> {
  await getDb()
    .delete(schema.gearAttributeDefs)
    .where(eq(schema.gearAttributeDefs.id, id));
}

/**
 * Replaces the def's type attachments wholesale. Detaching a type does
 * NOT delete the values already recorded against it — the def could be
 * reattached tomorrow, and silently destroying answers because somebody
 * unticked a checkbox is the kind of data loss nobody notices until the
 * data is needed.
 */
export async function setGearAttributeDefTypes(
  defId: string,
  typeIds: string[],
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.gearAttributeDefTypes)
    .where(eq(schema.gearAttributeDefTypes.defId, defId));
  if (typeIds.length > 0) {
    await db
      .insert(schema.gearAttributeDefTypes)
      .values(typeIds.map((typeId) => ({ defId, typeId })));
  }
}

/** How many answers a def carries, at either level. The manage dialog
 *  uses it to say what a delete would take with it. */
export async function countValuesForDef(defId: string): Promise<number> {
  const db = getDb();
  const [modelRows, itemRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.gearModelAttributeValues)
      .where(eq(schema.gearModelAttributeValues.defId, defId)),
    db
      .select({ value: count() })
      .from(schema.gearItemAttributeValues)
      .where(eq(schema.gearItemAttributeValues.defId, defId)),
  ]);
  return (modelRows[0]?.value ?? 0) + (itemRows[0]?.value ?? 0);
}

// ── values ─────────────────────────────────────────────────────────────

export interface GearAttributeValueRow {
  ownerId: string;
  defId: string;
  defPublicId: string;
  key: string;
  label: string;
  kind: schema.GearAttributeKind;
  unit: string | null;
  position: number;
  valueText: string | null;
  valueNumber: number | null;
}

/**
 * Values for a set of owners, keyed by owner id. Archived defs are
 * included on purpose: an answer that was recorded is still true, and
 * dropping it from the detail card the moment somebody archives the
 * question makes the card quietly lie.
 */
async function valuesFor(
  table:
    | typeof schema.gearModelAttributeValues
    | typeof schema.gearItemAttributeValues,
  ownerColumn:
    | typeof schema.gearModelAttributeValues.modelId
    | typeof schema.gearItemAttributeValues.itemId,
  defColumn:
    | typeof schema.gearModelAttributeValues.defId
    | typeof schema.gearItemAttributeValues.defId,
  ownerIds: string[],
): Promise<Map<string, GearAttributeValueRow[]>> {
  const map = new Map<string, GearAttributeValueRow[]>();
  if (ownerIds.length === 0) {
    return map;
  }
  const rows = await getDb()
    .select({
      ownerId: ownerColumn,
      defId: schema.gearAttributeDefs.id,
      defPublicId: schema.gearAttributeDefs.publicId,
      key: schema.gearAttributeDefs.key,
      label: schema.gearAttributeDefs.label,
      kind: schema.gearAttributeDefs.kind,
      unit: schema.gearAttributeDefs.unit,
      position: schema.gearAttributeDefs.position,
      valueText: table.valueText,
      valueNumber: table.valueNumber,
    })
    .from(table)
    .innerJoin(
      schema.gearAttributeDefs,
      eq(schema.gearAttributeDefs.id, defColumn),
    )
    .where(inArray(ownerColumn, ownerIds))
    .orderBy(
      asc(schema.gearAttributeDefs.position),
      asc(schema.gearAttributeDefs.label),
    );
  for (const row of rows) {
    const existing = map.get(row.ownerId);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.ownerId, [row]);
    }
  }
  return map;
}

export function listAttributeValuesForModels(
  modelIds: string[],
): Promise<Map<string, GearAttributeValueRow[]>> {
  return valuesFor(
    schema.gearModelAttributeValues,
    schema.gearModelAttributeValues.modelId,
    schema.gearModelAttributeValues.defId,
    modelIds,
  );
}

export function listAttributeValuesForItems(
  itemIds: string[],
): Promise<Map<string, GearAttributeValueRow[]>> {
  return valuesFor(
    schema.gearItemAttributeValues,
    schema.gearItemAttributeValues.itemId,
    schema.gearItemAttributeValues.defId,
    itemIds,
  );
}

export interface AttributeValueWrite {
  defId: string;
  valueText: string | null;
  valueNumber: number | null;
}

/**
 * Upserts the given answers and deletes the ones cleared to null.
 *
 * Only the defs named are touched, which is what makes partial edits
 * safe: the item form shows item-level defs for one type, and must not
 * wipe an answer belonging to a def it never rendered.
 */
async function writeValues(
  table:
    | typeof schema.gearModelAttributeValues
    | typeof schema.gearItemAttributeValues,
  ownerColumn:
    | typeof schema.gearModelAttributeValues.modelId
    | typeof schema.gearItemAttributeValues.itemId,
  defColumn:
    | typeof schema.gearModelAttributeValues.defId
    | typeof schema.gearItemAttributeValues.defId,
  ownerKey: "modelId" | "itemId",
  ownerId: string,
  writes: AttributeValueWrite[],
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  const db = getDb();
  const cleared = writes.filter(
    (w) => w.valueText === null && w.valueNumber === null,
  );
  const present = writes.filter(
    (w) => w.valueText !== null || w.valueNumber !== null,
  );
  if (cleared.length > 0) {
    await db.delete(table).where(
      and(
        eq(ownerColumn, ownerId),
        inArray(
          defColumn,
          cleared.map((w) => w.defId),
        ),
      ),
    );
  }
  if (present.length > 0) {
    await db
      .insert(table)
      .values(
        present.map((w) => ({
          [ownerKey]: ownerId,
          defId: w.defId,
          valueText: w.valueText,
          valueNumber: w.valueNumber,
        })),
      )
      .onConflictDoUpdate({
        target: [ownerColumn, defColumn],
        set: {
          valueText: sql`excluded.value_text`,
          valueNumber: sql`excluded.value_number`,
        },
      });
  }
}

export function setModelAttributeValues(
  modelId: string,
  writes: AttributeValueWrite[],
): Promise<void> {
  return writeValues(
    schema.gearModelAttributeValues,
    schema.gearModelAttributeValues.modelId,
    schema.gearModelAttributeValues.defId,
    "modelId",
    modelId,
    writes,
  );
}

export function setItemAttributeValues(
  itemId: string,
  writes: AttributeValueWrite[],
): Promise<void> {
  return writeValues(
    schema.gearItemAttributeValues,
    schema.gearItemAttributeValues.itemId,
    schema.gearItemAttributeValues.defId,
    "itemId",
    itemId,
    writes,
  );
}

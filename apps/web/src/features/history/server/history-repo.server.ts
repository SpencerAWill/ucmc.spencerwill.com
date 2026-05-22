/**
 * Pure data access for the /history archive. No auth — actions
 * enforce the `history:view` and `history:manage` gates. Past
 * officers are returned grouped by school year, in display order
 * (newest year first, with intra-year sort by role_order). Honorary
 * members are returned in their canonical `sort_order`. The
 * narrative markdown lives in a single-row `history_content` table;
 * `readNarrativeMarkdown` falls back to "" if the row is missing.
 */
import { asc, desc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

const HISTORY_CONTENT_ID = 1;

export async function readNarrativeMarkdown(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ md: schema.historyContent.narrativeMarkdown })
    .from(schema.historyContent)
    .where(eq(schema.historyContent.id, HISTORY_CONTENT_ID))
    .limit(1);
  return rows[0]?.md ?? "";
}

export async function writeNarrativeMarkdown(
  markdown: string,
  updatedBy: string,
): Promise<void> {
  const db = getDb();
  // UPSERT: the seed migration creates id=1, but tests that wipe the
  // table need this to recreate it. ON CONFLICT updates the existing
  // row in place — single-row pattern preserved either way.
  await db
    .insert(schema.historyContent)
    .values({
      id: HISTORY_CONTENT_ID,
      narrativeMarkdown: markdown,
      updatedAt: new Date(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: schema.historyContent.id,
      set: {
        narrativeMarkdown: markdown,
        updatedAt: new Date(),
        updatedBy,
      },
    });
}

export async function listHistoricalOfficers() {
  const db = getDb();
  return db
    .select({
      id: schema.historicalOfficers.id,
      schoolYear: schema.historicalOfficers.schoolYear,
      startYear: schema.historicalOfficers.startYear,
      role: schema.historicalOfficers.role,
      roleOrder: schema.historicalOfficers.roleOrder,
      name: schema.historicalOfficers.name,
      notes: schema.historicalOfficers.notes,
    })
    .from(schema.historicalOfficers)
    .orderBy(
      desc(schema.historicalOfficers.startYear),
      asc(schema.historicalOfficers.roleOrder),
    );
}

export async function listHonoraryMembers() {
  const db = getDb();
  return db
    .select({
      id: schema.honoraryMembers.id,
      name: schema.honoraryMembers.name,
      sortOrder: schema.honoraryMembers.sortOrder,
      notes: schema.honoraryMembers.notes,
    })
    .from(schema.honoraryMembers)
    .orderBy(asc(schema.honoraryMembers.sortOrder));
}

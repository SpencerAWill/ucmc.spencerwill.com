/**
 * Pure data access for the /history archive. No auth — actions
 * enforce the `history:view` and `history:manage` gates. Past
 * officers are returned grouped by school year, in display order
 * (newest year first, with intra-year sort by role_order). Honorary
 * members are returned in their canonical `sort_order`.
 *
 * Narrative markdown moved to the shared `markdown_pages` table in
 * migration 0049; reads/writes for it now go through
 * `src/server/markdown-pages/markdown-pages-repo.server.ts` keyed on
 * the `"history.narrative"` slug.
 */
import { asc, desc } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

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

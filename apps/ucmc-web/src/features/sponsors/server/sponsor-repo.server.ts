/**
 * Pure data access for /sponsors. No auth — the route guard enforces
 * `public_sponsors:view`, the actions enforce `public_sponsors:manage`,
 * and the perk projection is decided in the action layer.
 *
 * `listSponsors` deliberately selects `memberPerk` unconditionally. The
 * repo's job is the row; deciding who gets to see which columns is the
 * action's, and threading a boolean through the select would put the
 * same decision in two places.
 */
import { asc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

const sponsorColumns = {
  id: schema.sponsors.id,
  publicId: schema.sponsors.publicId,
  name: schema.sponsors.name,
  websiteUrl: schema.sponsors.websiteUrl,
  blurb: schema.sponsors.blurb,
  memberPerk: schema.sponsors.memberPerk,
  logoKey: schema.sponsors.logoKey,
  logoWidthPx: schema.sponsors.logoWidthPx,
  logoHeightPx: schema.sponsors.logoHeightPx,
  sortOrder: schema.sponsors.sortOrder,
} as const;

/** Curation order, `id` breaking a tie so the list is deterministic. */
export async function listSponsors() {
  return getDb()
    .select(sponsorColumns)
    .from(schema.sponsors)
    .orderBy(asc(schema.sponsors.sortOrder), asc(schema.sponsors.id));
}

export async function getSponsorById(id: string) {
  const rows = await getDb()
    .select(sponsorColumns)
    .from(schema.sponsors)
    .where(eq(schema.sponsors.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Next free slot at the end of the list.
 *
 * `MAX(sort_order) + 1` rather than a count, so a list that has had rows
 * deleted doesn't mint a sort_order that collides with an existing row
 * and leave the tie broken arbitrarily.
 */
export async function nextSponsorSortOrder(): Promise<number> {
  const rows = await getDb()
    .select({
      next: sql<number>`COALESCE(MAX(${schema.sponsors.sortOrder}), 0) + 1`,
    })
    .from(schema.sponsors);
  return rows.at(0)?.next ?? 1;
}

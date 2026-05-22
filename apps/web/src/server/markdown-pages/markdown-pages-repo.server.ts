/**
 * Pure data access for `markdown_pages`. No auth — the action layer
 * enforces the per-slug `*:manage` gate. Reads fall back to "" so a
 * page that hasn't been seeded yet renders the empty state instead
 * of crashing on a missing row.
 */
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type { MarkdownPageSlug } from "#/server/markdown-pages/slugs";

export async function readMarkdownPage(
  slug: MarkdownPageSlug,
): Promise<string> {
  const rows = await getDb()
    .select({ md: schema.markdownPages.markdown })
    .from(schema.markdownPages)
    .where(eq(schema.markdownPages.slug, slug))
    .limit(1);
  return rows[0]?.md ?? "";
}

/**
 * Bulk-read variant for callers that need several pages in one D1
 * round-trip (e.g. a future "site dashboard" that previews all
 * editable pages). Returns a slug → markdown map; missing slugs are
 * absent from the result.
 */
export async function readMarkdownPages(
  slugs: readonly MarkdownPageSlug[],
): Promise<Map<MarkdownPageSlug, string>> {
  if (slugs.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select({
      slug: schema.markdownPages.slug,
      markdown: schema.markdownPages.markdown,
    })
    .from(schema.markdownPages)
    .where(inArray(schema.markdownPages.slug, slugs as MarkdownPageSlug[]));
  const out = new Map<MarkdownPageSlug, string>();
  for (const row of rows) {
    out.set(row.slug, row.markdown);
  }
  return out;
}

export async function writeMarkdownPage(
  slug: MarkdownPageSlug,
  markdown: string,
  updatedBy: string,
): Promise<void> {
  // UPSERT: production migrations seed every known slug, but tests
  // that wipe the table want a no-op recreate. ON CONFLICT updates in
  // place; INSERT path covers fresh-DB races.
  await getDb()
    .insert(schema.markdownPages)
    .values({
      slug,
      markdown,
      updatedAt: new Date(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: schema.markdownPages.slug,
      set: {
        markdown,
        updatedAt: new Date(),
        updatedBy,
      },
    });
}

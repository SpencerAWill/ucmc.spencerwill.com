/**
 * Pure data access for the Goosedown Gazette archive. No auth —
 * actions and routes enforce the `public_gazette:view` /
 * `public_gazette:manage` gates. Issues are returned sorted newest-
 * first (start_year DESC, issue_number DESC); the view layer groups
 * by school year on top of this ordering.
 */
import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export async function listGazetteIssues() {
  const db = getDb();
  return db
    .select({
      id: schema.gazetteIssues.id,
      publicId: schema.gazetteIssues.publicId,
      schoolYear: schema.gazetteIssues.schoolYear,
      startYear: schema.gazetteIssues.startYear,
      issueNumber: schema.gazetteIssues.issueNumber,
      title: schema.gazetteIssues.title,
      editor: schema.gazetteIssues.editor,
      publishedAt: schema.gazetteIssues.publishedAt,
      description: schema.gazetteIssues.description,
      pdfKey: schema.gazetteIssues.pdfKey,
      pdfBytes: schema.gazetteIssues.pdfBytes,
    })
    .from(schema.gazetteIssues)
    .orderBy(
      desc(schema.gazetteIssues.startYear),
      desc(schema.gazetteIssues.issueNumber),
    );
}

export async function getGazetteIssueByPublicId(
  publicId: string,
): Promise<schema.GazetteIssue | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gazetteIssues)
    .where(eq(schema.gazetteIssues.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function getGazetteIssueById(
  id: string,
): Promise<schema.GazetteIssue | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gazetteIssues)
    .where(eq(schema.gazetteIssues.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

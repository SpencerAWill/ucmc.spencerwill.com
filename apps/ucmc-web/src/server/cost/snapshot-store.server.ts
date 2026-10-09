/**
 * Writes snapshot rows to D1.
 *
 * Upsert rather than insert: a run re-reads the trailing few days every
 * time, and the whole point of doing so is that a vendor figure which
 * settled late replaces the one we read early.
 */
import { asc, sql } from "drizzle-orm";

import type { SnapshotRow } from "#/server/cost/snapshot-row";
import { getDb, schema } from "#/server/db";

/**
 * D1 binds a limited number of parameters per statement (100), and each
 * row here carries nine. Chunking at 10 keeps a statement inside that
 * cap with room to spare — the same constraint `chunkedIn` was added
 * for elsewhere in this codebase.
 */
const ROWS_PER_STATEMENT = 10;

export async function upsertSnapshots(rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const db = getDb();
  const chunks = Array.from(
    { length: Math.ceil(rows.length / ROWS_PER_STATEMENT) },
    (_, i) => rows.slice(i * ROWS_PER_STATEMENT, (i + 1) * ROWS_PER_STATEMENT),
  );

  const capturedAt = Temporal.Now.instant();
  for (const chunk of chunks) {
    await db
      .insert(schema.costSnapshots)
      .values(chunk.map((row) => ({ ...row, capturedAt })))
      .onConflictDoUpdate({
        target: [
          schema.costSnapshots.source,
          schema.costSnapshots.serviceName,
          schema.costSnapshots.periodStart,
        ],
        set: {
          quantity: sql`excluded.quantity`,
          unit: sql`excluded.unit`,
          costCents: sql`excluded.cost_cents`,
          currency: sql`excluded.currency`,
          serviceFamily: sql`excluded.service_family`,
          periodEnd: sql`excluded.period_end`,
          capturedAt: sql`excluded.captured_at`,
        },
      });
  }
  return rows.length;
}

/**
 * Oldest day we hold, or null when the table is empty — the input the
 * window planner needs to decide between backfill and trailing.
 */
export async function earliestSnapshotDate(): Promise<string | null> {
  const rows = await getDb()
    .select({ periodStart: schema.costSnapshots.periodStart })
    .from(schema.costSnapshots)
    .orderBy(asc(schema.costSnapshots.periodStart))
    .limit(1);
  // Length check rather than `rows[0]?.…`: `noUncheckedIndexedAccess` is
  // off, so an index into an empty array types as a definite hit and the
  // optional chain reads to ESLint as dead code. This form is true to
  // both the runtime and the type.
  return rows.length > 0 ? rows[0].periodStart : null;
}

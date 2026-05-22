/**
 * Annual snapshot: read the current officers (live `roles` ⋈ `userRoles` ⋈
 * `users` ⋈ `profiles` join) and write them into the `historical_officers`
 * archive under the school year of the just-completed term.
 *
 * Scheduled to run March 1 each year — second semester of the executive
 * term per Constitution Bylaw §5.4. A March-1 fire in calendar year Y
 * corresponds to a term that began in Fall (Y-1) and ends in Summer Y,
 * so the school year is encoded as `${Y-1}-${(Y % 100).padStart(2, "0")}`
 * — matching the legacy seed format (1973-74, 1999-00, 2026-27).
 *
 * Why March 1 (not end-of-year):
 *   - It's mid-term: any Fall officer-transition ("/" mid-year) has
 *     already happened, but the board is still in office, so the
 *     snapshot reflects the term as it actually played out.
 *   - It avoids racing with elections in late Spring + the summer
 *     handover.
 *
 * Multi-holder roles are flattened to ONE row per (school_year, role)
 * with co-holders joined by ", " — matches the legacy convention where
 * concurrent co-holders use "," ("Equipment Manager: Diana Hsieh, David
 * Fryauff") and mid-year transitions use " / " ("Tom Bailey (Fall) /
 * Steve Kramrech"). The cron only sees the current snapshot, so all
 * co-holders are concurrent — comma separator.
 *
 * Idempotency: if any row with `start_year = Y-1` already exists, the
 * whole run is skipped. A re-fire from a transient worker retry never
 * doubles the archive; a manual pre-seed of a year (e.g. for
 * correction) is preserved untouched. This is more conservative than
 * `INSERT OR IGNORE` per-row because role names may have changed
 * between manual entry and the cron run (e.g. "VP" vs "Vice-President"),
 * which would otherwise produce both rows.
 */
import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface ArchiveOfficersResult {
  schoolYear: string;
  startYear: number;
  skipped: boolean;
  skipReason?: "already_archived" | "no_officers";
  rolesArchived: number;
}

/**
 * Compute the (schoolYear, startYear) pair from a March-1 fire date.
 * Exported for tests; the runtime always passes `new Date()`.
 */
export function schoolYearForArchiveFire(now: Date): {
  schoolYear: string;
  startYear: number;
} {
  const fireYear = now.getUTCFullYear();
  const startYear = fireYear - 1;
  const endTwoDigit = (fireYear % 100).toString().padStart(2, "0");
  return { schoolYear: `${startYear}-${endTwoDigit}`, startYear };
}

export async function archiveCurrentOfficers(
  now: Date = new Date(),
): Promise<ArchiveOfficersResult> {
  const { schoolYear, startYear } = schoolYearForArchiveFire(now);
  const db = getDb();

  // Idempotency guard. Any existing row for this start_year aborts —
  // manual corrections take precedence over the cron's snapshot.
  const existing = await db
    .select({ id: schema.historicalOfficers.id })
    .from(schema.historicalOfficers)
    .where(eq(schema.historicalOfficers.startYear, startYear))
    .limit(1);
  if (existing.length > 0) {
    return {
      schoolYear,
      startYear,
      skipped: true,
      skipReason: "already_archived",
      rolesArchived: 0,
    };
  }

  // Read the current officer set. Same filter as the public landing
  // /officers section (isOfficer + approved + has-profile) so we
  // archive exactly what was being shown to the public.
  const rows = await db
    .select({
      roleId: schema.roles.id,
      displayName: schema.roles.displayName,
      position: schema.roles.position,
      fullName: schema.profiles.fullName,
    })
    .from(schema.roles)
    .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.roles.id))
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(
      and(
        eq(schema.roles.isOfficer, true),
        eq(schema.users.status, "approved"),
      ),
    )
    // Deterministic ordering so the joined name strings are stable:
    // intra-role sort by fullName so "Alice, Bob" never flips to
    // "Bob, Alice" across re-runs of the same input.
    .orderBy(asc(schema.roles.position), asc(schema.profiles.fullName));

  if (rows.length === 0) {
    return {
      schoolYear,
      startYear,
      skipped: true,
      skipReason: "no_officers",
      rolesArchived: 0,
    };
  }

  // Group flat rows into one entry per role. Preserve the SQL
  // ORDER BY ordering by using insertion order on the Map.
  const byRole = new Map<
    string,
    { displayName: string; position: number; names: string[] }
  >();
  for (const r of rows) {
    let entry = byRole.get(r.roleId);
    if (!entry) {
      entry = {
        displayName: r.displayName,
        position: r.position,
        names: [],
      };
      byRole.set(r.roleId, entry);
    }
    entry.names.push(r.fullName);
  }

  const inserts = [...byRole.values()].map((entry) => ({
    schoolYear,
    startYear,
    role: entry.displayName,
    roleOrder: entry.position,
    name: entry.names.join(", "),
  }));

  await db.insert(schema.historicalOfficers).values(inserts);

  return {
    schoolYear,
    startYear,
    skipped: false,
    rolesArchived: inserts.length,
  };
}

/**
 * Read side of the public "Meet the officers" home-page section.
 *
 * Anonymous-safe: the landing route is public, so this query intentionally
 * has no auth gate. It only exposes (preferredName, avatarKey, displayName)
 * — the same identification surface a signed-in member already sees in the
 * directory, but limited to users assigned to a role flagged `is_officer`.
 *
 * Privacy invariants enforced here:
 *   1. `innerJoin(profiles)` — unclaimed (officer-pre-added) stubs never
 *      surface; they have no `profiles` row.
 *   2. `status = "approved"` — pending / rejected / deactivated never surface.
 *   3. `isOfficer = true` filter — admins explicitly opt a role into the
 *      public surface.
 *
 * Ordering: roles by `position` asc (admin-controlled in the role editor's
 * drag handle); members within a role by `preferredName` asc (predictable
 * default; no per-card ordering UI in v1).
 */
import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface LandingOfficerMember {
  userId: string;
  preferredName: string;
  avatarKey: string | null;
}

export interface LandingOfficerRole {
  roleId: string;
  displayName: string;
  position: number;
  members: LandingOfficerMember[];
}

export async function listLandingOfficers(): Promise<LandingOfficerRole[]> {
  const db = getDb();
  const rows = await db
    .select({
      roleId: schema.roles.id,
      displayName: schema.roles.displayName,
      position: schema.roles.position,
      userId: schema.users.id,
      preferredName: schema.profiles.preferredName,
      avatarKey: schema.profiles.avatarKey,
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
    .orderBy(asc(schema.roles.position), asc(schema.profiles.preferredName));

  // Group flat rows into one entry per role while preserving the
  // role-ordering coming out of the SQL ORDER BY.
  const byRole = new Map<string, LandingOfficerRole>();
  for (const r of rows) {
    let entry = byRole.get(r.roleId);
    if (!entry) {
      entry = {
        roleId: r.roleId,
        displayName: r.displayName,
        position: r.position,
        members: [],
      };
      byRole.set(r.roleId, entry);
    }
    entry.members.push({
      userId: r.userId,
      preferredName: r.preferredName,
      avatarKey: r.avatarKey,
    });
  }
  return [...byRole.values()];
}

/**
 * Action implementations for member-management server fns (registrations
 * approval queue). Follows the same shell + .server.ts split as
 * magic-link-actions.server.ts — the shell in `./member-fns.ts` loads
 * this via a dynamic import inside its createServerFn handlers.
 */
import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { loadCurrentPrincipal } from "#/server/auth/session.server";
import type { Principal } from "#/server/auth/principal.server";
import { getDb, schema } from "#/server/db";

/**
 * Loads the current principal and asserts that they hold the
 * `registrations:approve` permission. Throws if unsigned-in or missing
 * the permission — callers in this file treat the thrown error as a
 * hard stop (the shell maps it to a 403-style response shape).
 */
async function requireApprover(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("registrations:approve")) {
    throw new Error("Forbidden: missing registrations:approve");
  }
  return principal;
}

// ── list ─────────────────────────────────────────────────────────────────

export interface PendingRegistration {
  userId: string;
  email: string;
  createdAt: Date;
  hasProfile: boolean;
  fullName: string | null;
  preferredName: string | null;
  ucAffiliation: string | null;
}

const DEFAULT_LIMIT = 50;

export interface PendingRegistrationsPage {
  rows: PendingRegistration[];
  total: number;
}

export async function listPendingRegistrationsAction(opts: {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<PendingRegistrationsPage> {
  await requireApprover();
  const db = getDb();

  const conditions = [eq(schema.users.status, "pending")];
  if (opts.from) {
    // Explicit UTC to avoid local-timezone shifts in the devcontainer.
    conditions.push(
      gte(schema.users.createdAt, new Date(`${opts.from}T00:00:00.000Z`)),
    );
  }
  if (opts.to) {
    // Inclusive through end of the selected day in UTC.
    conditions.push(
      lte(schema.users.createdAt, new Date(`${opts.to}T23:59:59.999Z`)),
    );
  }

  const where = and(...conditions);

  // Run the count and the page query in parallel.
  const [countResult, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(where),
    db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        createdAt: schema.users.createdAt,
        fullName: schema.profiles.fullName,
        preferredName: schema.profiles.preferredName,
        ucAffiliation: schema.profiles.ucAffiliation,
      })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(where)
      .orderBy(schema.users.createdAt)
      .limit(opts.limit ?? DEFAULT_LIMIT)
      .offset(opts.offset ?? 0),
  ]);

  return {
    total: countResult[0]?.value ?? 0,
    rows: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      createdAt: r.createdAt,
      hasProfile: r.fullName !== null,
      fullName: r.fullName,
      preferredName: r.preferredName,
      ucAffiliation: r.ucAffiliation,
    })),
  };
}

// ── list approved members ─────────────────────────────────────────────────

export interface MemberSummary {
  userId: string;
  email: string;
  fullName: string | null;
  preferredName: string | null;
  ucAffiliation: string | null;
  roles: string[];
}

export async function listMembersAction(opts: {
  search?: string;
  affiliations?: string;
  roles?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: MemberSummary[]; total: number }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (principal.status !== "approved") {
    throw new Error("Not approved");
  }

  const db = getDb();

  const conditions = [eq(schema.users.status, "approved")];

  // Affiliation filter (comma-separated list).
  const affiliationList = opts.affiliations?.split(",").filter(Boolean) ?? [];
  if (affiliationList.length > 0) {
    conditions.push(
      inArray(
        schema.profiles.ucAffiliation,
        affiliationList as [schema.UcAffiliation, ...schema.UcAffiliation[]],
      ),
    );
  }

  // Role filter (comma-separated list). Requires a subquery-style
  // approach — we join userRoles and filter by role name.
  const roleList = opts.roles?.split(",").filter(Boolean) ?? [];

  // TODO: wire opts.search to LIKE on name/email.

  // Build the base query with the profile join (needed for affiliation
  // filter and display columns). Role filtering is done post-query
  // because a join to userRoles+roles would multiply rows for users
  // with multiple roles; for a small dataset this is fine.
  const where = and(...conditions);

  // Sort order.
  const orderBy = (() => {
    switch (opts.sort) {
      case "name_desc":
        return desc(schema.profiles.fullName);
      case "newest":
        return desc(schema.users.createdAt);
      case "oldest":
        return asc(schema.users.createdAt);
      case "name_asc":
      default:
        return asc(schema.profiles.fullName);
    }
  })();

  const [countResult, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(where),
    db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        fullName: schema.profiles.fullName,
        preferredName: schema.profiles.preferredName,
        ucAffiliation: schema.profiles.ucAffiliation,
      })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0),
  ]);

  // Batch-fetch roles for all users on this page.
  const userIds = rows.map((r) => r.userId);
  const roleRows =
    userIds.length > 0
      ? await db
          .select({
            userId: schema.userRoles.userId,
            roleName: schema.roles.name,
          })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(inArray(schema.userRoles.userId, userIds))
      : [];

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.roleName);
    rolesByUser.set(r.userId, list);
  }

  let mappedRows = rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    fullName: r.fullName,
    preferredName: r.preferredName,
    ucAffiliation: r.ucAffiliation,
    roles: rolesByUser.get(r.userId) ?? [],
  }));

  let total = countResult[0]?.value ?? 0;

  // Role filter — applied in JS after the batch role fetch. For a small
  // dataset this is simpler than a correlated subquery.
  if (roleList.length > 0) {
    mappedRows = mappedRows.filter((m) =>
      roleList.some((r) => m.roles.includes(r)),
    );
    total = mappedRows.length;
  }

  return { total, rows: mappedRows };
}

// ── available roles ──────────────────────────────────────────────────────

export interface RoleOption {
  id: string;
  name: string;
  description: string | null;
}

export async function listRolesAction(): Promise<RoleOption[]> {
  const principal = await loadCurrentPrincipal();
  if (!principal || principal.status !== "approved") {
    throw new Error("Not authorized");
  }
  return getDb().query.roles.findMany({
    columns: { id: true, name: true, description: true },
    orderBy: (roles, { asc: a }) => [a(roles.name)],
  });
}

// ── approve (bulk) ───────────────────────────────────────────────────────

export async function approveRegistrationsAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const approver = await requireApprover();
  const db = getDb();

  // Single UPDATE for all users.
  await db
    .update(schema.users)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: approver.userId,
    })
    .where(inArray(schema.users.id, userIds));

  // Batch-insert the member role grant for every approved user.
  await db
    .insert(schema.userRoles)
    .values(userIds.map((userId) => ({ userId, roleId: "role_member" })))
    .onConflictDoNothing();

  // TODO: send approval notification emails (per-user; will need a loop
  // or a batch email API call here when email notifications are added).

  return { ok: true };
}

// ── reject (bulk) ────────────────────────────────────────────────────────

export async function rejectRegistrationsAction(
  userIds: string[],
): Promise<{ ok: true }> {
  await requireApprover();

  await getDb()
    .update(schema.users)
    .set({ status: "rejected" })
    .where(inArray(schema.users.id, userIds));

  // TODO: send rejection notification emails (per-user).

  return { ok: true };
}

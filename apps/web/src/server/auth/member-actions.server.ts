/**
 * Action implementations for member-management server fns (registrations
 * approval queue, member lifecycle, admin profile editing). Follows the
 * same shell + .server.ts split as magic-link-actions.server.ts — the
 * shell in `./member-fns.ts` loads this via a dynamic import inside its
 * createServerFn handlers.
 */
import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { loadCurrentPrincipal } from "#/features/auth/server/session.server";
import type { Principal } from "#/features/auth/server/principal.server";
import { getDb, schema } from "#/server/db";

// ── auth helpers ────────────────────────────────────────────────────────

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

/** Requires the `members:manage` permission. */
async function requireMembersManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("members:manage")) {
    throw new Error("Forbidden: missing members:manage");
  }
  return principal;
}

/** Requires the caller to be signed in and approved. */
async function requireApprovedPrincipal(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (principal.status !== "approved") {
    throw new Error("Not approved");
  }
  return principal;
}

// ── list pending registrations ──────────────────────────────────────────

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

// ── list members (directory) ────────────────────────────────────────────

export interface EmergencyContactSummary {
  name: string;
  phone: string;
  relationship: schema.ContactRelationship;
}

export interface MemberSummary {
  userId: string;
  publicId: string;
  email: string;
  fullName: string | null;
  preferredName: string | null;
  ucAffiliation: string | null;
  avatarKey: string | null;
  roles: string[];
  status: schema.UserStatus;
  // Private fields — null/empty when the caller lacks members:view_private.
  phone: string | null;
  emergencyContacts: EmergencyContactSummary[];
  mNumber: string | null;
}

export async function listMembersAction(opts: {
  search?: string;
  affiliations?: string;
  roles?: string;
  statuses?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: MemberSummary[]; total: number }> {
  const principal = await requireApprovedPrincipal();

  const db = getDb();
  const canManage = principal.permissions.includes("members:manage");
  const canViewPrivate = principal.permissions.includes("members:view_private");

  // Status filter: members:manage holders can filter by any status;
  // everyone else is locked to "approved".
  const statusList = canManage
    ? (opts.statuses?.split(",").filter(Boolean) ?? ["approved"])
    : ["approved"];

  const conditions =
    statusList.length === 1
      ? [eq(schema.users.status, statusList[0] as schema.UserStatus)]
      : [
          inArray(
            schema.users.status,
            statusList as [schema.UserStatus, ...schema.UserStatus[]],
          ),
        ];

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

  const selectFields = {
    userId: schema.users.id,
    publicId: schema.users.publicId,
    email: schema.users.email,
    status: schema.users.status,
    fullName: schema.profiles.fullName,
    preferredName: schema.profiles.preferredName,
    ucAffiliation: schema.profiles.ucAffiliation,
    avatarKey: schema.profiles.avatarKey,
    phone: schema.profiles.phone,
    mNumber: schema.profiles.mNumber,
  };

  const [countResult, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(where),
    db
      .select(selectFields)
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(opts.limit ?? DEFAULT_LIMIT)
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

  // Batch-fetch emergency contacts for page users (private data).
  const contactRows =
    canViewPrivate && userIds.length > 0
      ? await db
          .select({
            userId: schema.emergencyContacts.userId,
            name: schema.emergencyContacts.name,
            phone: schema.emergencyContacts.phone,
            relationship: schema.emergencyContacts.relationship,
          })
          .from(schema.emergencyContacts)
          .where(inArray(schema.emergencyContacts.userId, userIds))
      : [];

  const contactsByUser = new Map<string, EmergencyContactSummary[]>();
  for (const c of contactRows) {
    const list = contactsByUser.get(c.userId) ?? [];
    list.push({ name: c.name, phone: c.phone, relationship: c.relationship });
    contactsByUser.set(c.userId, list);
  }

  let mappedRows: MemberSummary[] = rows.map((r) => ({
    userId: r.userId,
    publicId: r.publicId,
    email: r.email,
    fullName: r.fullName,
    preferredName: r.preferredName,
    ucAffiliation: r.ucAffiliation,
    avatarKey: r.avatarKey,
    roles: rolesByUser.get(r.userId) ?? [],
    status: r.status,
    phone: canViewPrivate ? r.phone : null,
    emergencyContacts: canViewPrivate
      ? (contactsByUser.get(r.userId) ?? [])
      : [],
    mNumber: canViewPrivate ? r.mNumber : null,
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

// ── get member detail ───────────────────────────────────────────────────

export interface MemberDetail {
  userId: string;
  publicId: string;
  email: string;
  status: schema.UserStatus;
  createdAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  fullName: string | null;
  preferredName: string | null;
  ucAffiliation: string | null;
  avatarKey: string | null;
  bio: string | null;
  roles: string[];
  // Private fields — null/empty when caller lacks members:view_private.
  phone: string | null;
  emergencyContacts: EmergencyContactSummary[];
  mNumber: string | null;
  // Session count — null when caller lacks sessions:revoke.
  activeSessions: number | null;
}

export async function getMemberDetailAction(
  publicId: string,
): Promise<MemberDetail> {
  const principal = await requireApprovedPrincipal();
  const db = getDb();
  const canViewPrivate = principal.permissions.includes("members:view_private");
  const canRevokeSessions = principal.permissions.includes("sessions:revoke");

  const row = await db
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      email: schema.users.email,
      status: schema.users.status,
      createdAt: schema.users.createdAt,
      approvedAt: schema.users.approvedAt,
      approvedBy: schema.users.approvedBy,
      fullName: schema.profiles.fullName,
      preferredName: schema.profiles.preferredName,
      ucAffiliation: schema.profiles.ucAffiliation,
      avatarKey: schema.profiles.avatarKey,
      bio: schema.profiles.bio,
      phone: schema.profiles.phone,
      mNumber: schema.profiles.mNumber,
    })
    .from(schema.users)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.publicId, publicId))
    .get();

  if (!row) {
    throw new Error("User not found");
  }

  const userId = row.userId;

  // Fetch roles.
  const roleRows = await db
    .select({ roleName: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));

  // Fetch emergency contacts (private data).
  const contacts: EmergencyContactSummary[] = canViewPrivate
    ? await db
        .select({
          name: schema.emergencyContacts.name,
          phone: schema.emergencyContacts.phone,
          relationship: schema.emergencyContacts.relationship,
        })
        .from(schema.emergencyContacts)
        .where(eq(schema.emergencyContacts.userId, userId))
    : [];

  // Optionally count active sessions.
  let activeSessions: number | null = null;
  if (canRevokeSessions) {
    const sessionCount = await db
      .select({ value: count() })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    activeSessions = sessionCount[0]?.value ?? 0;
  }

  return {
    userId: row.userId,
    publicId: row.publicId,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    fullName: row.fullName,
    preferredName: row.preferredName,
    ucAffiliation: row.ucAffiliation,
    avatarKey: row.avatarKey,
    bio: row.bio,
    roles: roleRows.map((r) => r.roleName),
    phone: canViewPrivate ? row.phone : null,
    emergencyContacts: contacts,
    mNumber: canViewPrivate ? row.mNumber : null,
    activeSessions,
  };
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

// ── deactivate (bulk) ───────────────────────────────────────────────────

export async function deactivateMembersAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const principal = await requireMembersManager();

  if (userIds.includes(principal.userId)) {
    throw new Error("Cannot deactivate yourself");
  }

  const db = getDb();

  // Only deactivate users that are currently approved.
  await db
    .update(schema.users)
    .set({ status: "deactivated" })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "approved"),
      ),
    );

  // Immediately revoke all sessions so deactivated users are signed out.
  await db
    .delete(schema.sessions)
    .where(inArray(schema.sessions.userId, userIds));

  return { ok: true };
}

// ── reactivate (bulk) ───────────────────────────────────────────────────

export async function reactivateMembersAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const approver = await requireMembersManager();
  const db = getDb();

  // Only reactivate users that are currently deactivated.
  await db
    .update(schema.users)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: approver.userId,
    })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "deactivated"),
      ),
    );

  // Ensure member role is granted (may already exist from prior approval).
  await db
    .insert(schema.userRoles)
    .values(userIds.map((userId) => ({ userId, roleId: "role_member" })))
    .onConflictDoNothing();

  return { ok: true };
}

// ── un-reject (bulk) ────────────────────────────────────────────────────

export async function unrejectMembersAction(
  userIds: string[],
): Promise<{ ok: true }> {
  await requireMembersManager();

  // Move rejected users back to pending so they re-enter the approval queue.
  await getDb()
    .update(schema.users)
    .set({ status: "pending" })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "rejected"),
      ),
    );

  return { ok: true };
}

// ── revoke user sessions ────────────────────────────────────────────────

export async function revokeUserSessionsAction(
  userId: string,
): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("sessions:revoke")) {
    throw new Error("Forbidden: missing sessions:revoke");
  }
  if (userId === principal.userId) {
    throw new Error("Cannot revoke your own sessions (use Sign Out)");
  }

  await getDb()
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId));

  return { ok: true };
}

// ── admin profile edit ──────────────────────────────────────────────────

export async function adminUpdateProfileAction(input: {
  userId: string;
  fullName: string;
  preferredName: string;
  mNumber: string;
  phone: string;
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: schema.ContactRelationship;
  }>;
  ucAffiliation: schema.UcAffiliation;
}): Promise<{ ok: true }> {
  await requireMembersManager();

  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, input.userId),
    columns: { id: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

  const { userId, emergencyContacts, ...profileData } = input;
  await db
    .insert(schema.profiles)
    .values({ userId, ...profileData, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.profiles.userId,
      set: { ...profileData, updatedAt: new Date() },
    });

  // Replace emergency contacts: delete existing, then insert new set.
  await db
    .delete(schema.emergencyContacts)
    .where(eq(schema.emergencyContacts.userId, userId));

  if (emergencyContacts.length > 0) {
    await db.insert(schema.emergencyContacts).values(
      emergencyContacts.map((ec) => ({
        id: `ec_${uuidv7()}`,
        userId,
        name: ec.name,
        phone: ec.phone,
        relationship: ec.relationship,
      })),
    );
  }

  return { ok: true };
}

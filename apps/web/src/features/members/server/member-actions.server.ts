/**
 * Action implementations for member-management server fns (registrations
 * approval queue, member lifecycle, admin profile editing). Follows the
 * same shell + .server.ts split as magic-link-actions.server.ts — the
 * shell in `./member-fns.ts` loads this via a dynamic import inside its
 * createServerFn handlers.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lte,
} from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  buildAuditEventStatement,
  recordAuditEvent,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import type { Principal } from "#/server/auth/principal.server";
import { getDb, schema } from "#/server/db";
import { requireApprover } from "#/features/members/server/permissions.server";

// ── auth helpers ────────────────────────────────────────────────────────

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
        email: schema.userEmails.email,
        createdAt: schema.users.createdAt,
        fullName: schema.profiles.fullName,
        preferredName: schema.profiles.preferredName,
        ucAffiliation: schema.profiles.ucAffiliation,
      })
      .from(schema.users)
      .innerJoin(
        schema.userEmails,
        and(
          eq(schema.userEmails.userId, schema.users.id),
          eq(schema.userEmails.isPrimary, true),
        ),
      )
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

// Directory + detail surfaces both filter `status = 'unclaimed'` out at
// the SQL layer (officer-pre-added stubs aren't directory members),
// so the projection types narrow accordingly. Callers that render
// `<StatusBadge>` get the same narrowing for free.
export type DirectoryStatus = Exclude<schema.UserStatus, "unclaimed">;

export interface MemberSummary {
  userId: string;
  publicId: string;
  email: string;
  fullName: string | null;
  preferredName: string | null;
  ucAffiliation: string | null;
  avatarKey: string | null;
  roles: string[];
  status: DirectoryStatus;
  // Private fields — null/empty when the caller lacks members:view_private.
  phone: string | null;
  emergencyContacts: EmergencyContactSummary[];
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
  // everyone else is locked to "approved". `unclaimed` is *always*
  // excluded — these are officer-pre-added stubs with no profile, no
  // verified email, and no avatar; they have their own tab on
  // /members/registrations and do not belong in the directory.
  const requested = canManage
    ? (opts.statuses?.split(",").filter(Boolean) ?? ["approved"])
    : ["approved"];
  const statusList = requested.filter((s) => s !== "unclaimed");
  // If the caller passed *only* "unclaimed" we'd end up with an empty
  // status list, which would silently match every status. Fall back to
  // the safe default so the empty-input case returns no rows rather
  // than the entire user table.
  if (statusList.length === 0) {
    statusList.push("approved");
  }

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

  // Role filter (comma-separated list). Pushed into SQL via an EXISTS
  // subquery so the count + page query agree on the same filtered set.
  // A direct join to userRoles+roles would multiply page rows for users
  // with multiple roles; EXISTS keeps the row count to one per user.
  const roleList = opts.roles?.split(",").filter(Boolean) ?? [];
  if (roleList.length > 0) {
    const roleNames = roleList as [string, ...string[]];
    conditions.push(
      exists(
        db
          .select({ one: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(
            and(
              eq(schema.userRoles.userId, schema.users.id),
              inArray(schema.roles.name, roleNames),
            ),
          ),
      ),
    );
  }

  // TODO: wire opts.search to LIKE on name/email.

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
    email: schema.userEmails.email,
    status: schema.users.status,
    fullName: schema.profiles.fullName,
    preferredName: schema.profiles.preferredName,
    ucAffiliation: schema.profiles.ucAffiliation,
    avatarKey: schema.profiles.avatarKey,
    phone: schema.profiles.phone,
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
      .innerJoin(
        schema.userEmails,
        and(
          eq(schema.userEmails.userId, schema.users.id),
          eq(schema.userEmails.isPrimary, true),
        ),
      )
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

  const mappedRows: MemberSummary[] = rows.map((r) => ({
    userId: r.userId,
    publicId: r.publicId,
    email: r.email,
    fullName: r.fullName,
    preferredName: r.preferredName,
    ucAffiliation: r.ucAffiliation,
    avatarKey: r.avatarKey,
    roles: rolesByUser.get(r.userId) ?? [],
    // Cast: the WHERE clause above filters `status='unclaimed'` out
    // of the result set unconditionally (see the `statusList.filter`
    // in the conditions builder), so `r.status` is guaranteed not to
    // be "unclaimed" at runtime — the cast just lets the type system
    // see what the SQL already enforces.
    status: r.status as DirectoryStatus,
    phone: canViewPrivate ? r.phone : null,
    emergencyContacts: canViewPrivate
      ? (contactsByUser.get(r.userId) ?? [])
      : [],
  }));

  return { total: countResult[0]?.value ?? 0, rows: mappedRows };
}

// ── get member detail ───────────────────────────────────────────────────

export interface MemberDetail {
  userId: string;
  publicId: string;
  email: string;
  status: DirectoryStatus;
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
      email: schema.userEmails.email,
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
    })
    .from(schema.users)
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.users.id),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.users.publicId, publicId))
    .get();

  if (!row) {
    throw new Error("User not found");
  }
  // Unclaimed (officer-pre-added) stubs aren't directory members — they
  // have no profile, no verified email, and no avatar. The list query
  // already excludes them; mirror that here so a manually-typed
  // /members/<publicId> URL can't surface a stub on the detail page.
  // Treat as 404 so the route renders the same not-found state any
  // unknown publicId would.
  if (row.status === "unclaimed") {
    throw new Error("User not found");
  }

  const userId = row.userId;

  // Roles, emergency contacts, and the active-session count all key
  // on `userId` only — issue them in parallel via `Promise.all` so
  // their wall-clock latencies overlap (D1 still receives one HTTP
  // request per query — `db.batch` would collapse to one request but
  // would also force us to run the privileged contacts + sessions
  // queries unconditionally, which is wasted work for the common
  // regular-member caller). Permission gates above decide whether to
  // fetch private contacts and the session count.
  const [roleRows, contacts, sessionCountRows] = await Promise.all([
    db
      .select({ roleName: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId)),
    canViewPrivate
      ? db
          .select({
            name: schema.emergencyContacts.name,
            phone: schema.emergencyContacts.phone,
            relationship: schema.emergencyContacts.relationship,
          })
          .from(schema.emergencyContacts)
          .where(eq(schema.emergencyContacts.userId, userId))
      : Promise.resolve<EmergencyContactSummary[]>([]),
    canRevokeSessions
      ? db
          .select({ value: count() })
          .from(schema.sessions)
          .where(eq(schema.sessions.userId, userId))
      : Promise.resolve<{ value: number }[]>([]),
  ]);

  const activeSessions = canRevokeSessions
    ? (sessionCountRows[0]?.value ?? 0)
    : null;

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

  // `.returning({ id })` so the audit + role-grant operate on the
  // rows the UPDATE actually touched, not the raw request list.
  // This dedupes a buggy caller that repeats the same id and filters
  // out nonexistent IDs — without it, both cases would emit phantom
  // `registration.approved` rows.
  const updated = await db
    .update(schema.users)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: approver.userId,
    })
    .where(inArray(schema.users.id, userIds))
    .returning({ id: schema.users.id });
  const updatedIds = updated.map(({ id }) => id);

  if (updatedIds.length > 0) {
    await db
      .insert(schema.userRoles)
      .values(updatedIds.map((userId) => ({ userId, roleId: "role_member" })))
      .onConflictDoNothing();
  }

  // Sequential audit — see `audit-log.server.ts` residual case
  // (`.returning()` result drives the audit set; D1 batches can't
  // reference a prior statement's output).
  await recordAuditEvents(
    updatedIds.map((userId) => ({
      actorUserId: approver.userId,
      action: "registration.approved",
      targetUserId: userId,
    })),
  );

  // TODO: send approval notification emails (per-user; will need a loop
  // or a batch email API call here when email notifications are added).

  return { ok: true };
}

// ── reject (bulk) ────────────────────────────────────────────────────────

export async function rejectRegistrationsAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const approver = await requireApprover();

  // `.returning({ id })` gives us the rows the UPDATE actually
  // touched. Audit only those so a stale or malformed request that
  // includes already-rejected or nonexistent IDs doesn't produce
  // false-positive audit rows.
  const updated = await getDb()
    .update(schema.users)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(inArray(schema.users.id, userIds))
    .returning({ id: schema.users.id });

  // Sequential audit — see `audit-log.server.ts` residual case.
  await recordAuditEvents(
    updated.map(({ id }) => ({
      actorUserId: approver.userId,
      action: "registration.rejected",
      targetUserId: id,
    })),
  );

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

  // Only deactivate users that are currently approved. `.returning`
  // gives the IDs of rows the UPDATE actually touched so the audit
  // log doesn't claim a deactivation for users in the wrong status.
  const updated = await db
    .update(schema.users)
    .set({ status: "deactivated", deactivatedAt: new Date() })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "approved"),
      ),
    )
    .returning({ id: schema.users.id });

  // Immediately revoke all sessions so deactivated users are signed
  // out. Limit to the IDs that actually transitioned — purging
  // sessions for users we didn't touch would be a surprise side
  // effect of the bulk endpoint.
  const updatedIds = updated.map(({ id }) => id);
  if (updatedIds.length > 0) {
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, updatedIds));
  }

  // Sequential audit — see `audit-log.server.ts` residual case.
  await recordAuditEvents(
    updatedIds.map((userId) => ({
      actorUserId: principal.userId,
      action: "member.deactivated",
      targetUserId: userId,
    })),
  );

  return { ok: true };
}

// ── reactivate (bulk) ───────────────────────────────────────────────────

export async function reactivateMembersAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const approver = await requireMembersManager();
  const db = getDb();

  // Only reactivate users that are currently deactivated. Clear
  // `deactivatedAt` so a future deactivation gets a fresh retention
  // clock rather than counting from the *first* deactivation.
  // `.returning` so the audit + role-grant operate on the rows that
  // actually transitioned, not the raw request list.
  const updated = await db
    .update(schema.users)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: approver.userId,
      deactivatedAt: null,
    })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "deactivated"),
      ),
    )
    .returning({ id: schema.users.id });
  const updatedIds = updated.map(({ id }) => id);

  // Ensure member role is granted on the rows we actually
  // reactivated (may already exist from prior approval).
  if (updatedIds.length > 0) {
    await db
      .insert(schema.userRoles)
      .values(updatedIds.map((userId) => ({ userId, roleId: "role_member" })))
      .onConflictDoNothing();
  }

  // Sequential audit — see `audit-log.server.ts` residual case.
  await recordAuditEvents(
    updatedIds.map((userId) => ({
      actorUserId: approver.userId,
      action: "member.reactivated",
      targetUserId: userId,
    })),
  );

  return { ok: true };
}

// ── un-reject (bulk) ────────────────────────────────────────────────────

export async function unrejectMembersAction(
  userIds: string[],
): Promise<{ ok: true }> {
  const principal = await requireMembersManager();

  // Move rejected users back to pending so they re-enter the approval
  // queue. Clear `rejectedAt` so a future rejection gets a fresh
  // retention clock rather than counting from the *first* rejection.
  // `.returning` so we only audit rows that actually changed.
  const updated = await getDb()
    .update(schema.users)
    .set({ status: "pending", rejectedAt: null })
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.status, "rejected"),
      ),
    )
    .returning({ id: schema.users.id });

  // Sequential audit — see `audit-log.server.ts` residual case.
  await recordAuditEvents(
    updated.map(({ id }) => ({
      actorUserId: principal.userId,
      action: "registration.unrejected",
      targetUserId: id,
    })),
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

  const deleted = await getDb()
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });

  // Audit only when something was actually revoked. Session count
  // captured in metadata so the audit page can show the blast
  // radius without joining back to a now-empty sessions table.
  // Sequential audit — see `audit-log.server.ts` residual case.
  if (deleted.length > 0) {
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "member.sessions_revoked",
      targetUserId: userId,
      metadata: { revokedCount: deleted.length },
    });
  }

  return { ok: true };
}

// ── admin profile edit ──────────────────────────────────────────────────

export async function adminUpdateProfileAction(input: {
  userId: string;
  fullName: string;
  preferredName: string;
  phone: string;
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: schema.ContactRelationship;
  }>;
  ucAffiliation: schema.UcAffiliation;
}): Promise<{ ok: true }> {
  const principal = await requireMembersManager();

  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, input.userId),
    columns: { id: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

  const { userId, emergencyContacts, ...profileData } = input;
  // Profile upsert + emergency-contact replace + audit row, all
  // committed as one D1 batch. Field names only in audit metadata —
  // the values themselves would be PII by definition since this
  // action edits a person's identifying info.
  const stmts = [
    db
      .insert(schema.profiles)
      .values({ userId, ...profileData, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.profiles.userId,
        set: { ...profileData, updatedAt: new Date() },
      }),
    db
      .delete(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, userId)),
    ...(emergencyContacts.length > 0
      ? [
          db.insert(schema.emergencyContacts).values(
            emergencyContacts.map((ec) => ({
              id: `ec_${uuidv7()}`,
              userId,
              name: ec.name,
              phone: ec.phone,
              relationship: ec.relationship,
            })),
          ),
        ]
      : []),
    buildAuditEventStatement({
      actorUserId: principal.userId,
      action: "profile.force_edited",
      targetUserId: userId,
      metadata: {
        emergencyContactCount: emergencyContacts.length,
        ucAffiliation: profileData.ucAffiliation,
      },
    }),
  ];
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}

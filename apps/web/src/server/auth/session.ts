/**
 * Server-side helpers for resolving the current session from the cookie + D1
 * store. Used by server functions and the root loader (via getSessionFn).
 */
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import {
  deleteSession,
  getSession as storeGetSession,
  putSession,
  SESSION_TTL_MS,
} from "#/server/store";
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from "#/server/session-cookie";

export interface SessionPrincipal {
  userId: string;
  email: string;
  status: schema.UserStatus;
  hasProfile: boolean;
  roles: string[];
  permissions: string[];
}

export async function loadCurrentPrincipal(): Promise<SessionPrincipal | null> {
  const sid = readSessionCookie();
  if (!sid) return null;

  const session = await storeGetSession(sid);
  if (!session) {
    clearSessionCookie();
    return null;
  }

  const principal = await loadPrincipal(session.userId);
  if (!principal) {
    await deleteSession(sid);
    clearSessionCookie();
    return null;
  }

  // Slide the window if it's been more than ~1h since last seen.
  const now = Date.now();
  if (now - session.lastSeenAt > 1000 * 60 * 60) {
    await putSession({
      ...session,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
  }

  return principal;
}

export async function loadPrincipal(
  userId: string,
): Promise<SessionPrincipal | null> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  if (!user) return null;

  const profile = await getDb().query.profiles.findFirst({
    where: eq(schema.profiles.userId, userId),
    columns: { userId: true },
  });

  // Roles + permissions in one round-trip via two simple selects.
  const userRoleRows = await getDb()
    .select({ roleId: schema.userRoles.roleId, name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));

  const roleIds = userRoleRows.map((r) => r.roleId);
  let permissions: string[] = [];
  if (roleIds.length > 0) {
    const rows = await getDb()
      .select({ name: schema.permissions.name })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(inArray(schema.rolePermissions.roleId, roleIds));
    permissions = Array.from(new Set(rows.map((r) => r.name)));
  }

  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    hasProfile: Boolean(profile),
    roles: userRoleRows.map((r) => r.name),
    permissions,
  };
}

export async function openSession(userId: string): Promise<void> {
  const sid = crypto.randomUUID();
  const now = Date.now();
  await putSession({
    id: sid,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  writeSessionCookie(sid);
}

export async function closeSession(): Promise<void> {
  const sid = readSessionCookie();
  if (sid) await deleteSession(sid);
  clearSessionCookie();
}

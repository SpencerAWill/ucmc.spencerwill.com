/**
 * D1 factories for users and roles (#323).
 *
 * Every default here is the one place a new NOT NULL column on `users`,
 * `user_emails` or `profiles` gets a value for the test suite, so a
 * schema change edits this file instead of every `seedUser` copy.
 *
 * Workers pool only: these write to D1 through `getDb()`. Storage
 * isolation is still per file, so the caller's `beforeEach` cleans the
 * tables (see .claude/rules/testing.md).
 */
import { normalizeEmail } from "#/server/auth/email-normalize";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

type UserInsert = typeof schema.users.$inferInsert;
type ProfileInsert = typeof schema.profiles.$inferInsert;
type RoleInsert = typeof schema.roles.$inferInsert;

export type CreateUserOptions = Partial<UserInsert> & {
  /** Defaults to a unique `@example.com` address. */
  email?: string;
  /**
   * Overrides for the profile row, or `false` for a user who hasn't
   * finished registration. Most action paths read `preferredName`, so
   * the default is to create one.
   */
  profile?: Partial<Omit<ProfileInsert, "userId">> | false;
  /** Role ids to grant, seeded (`role_member`) or from `createRole`. */
  roles?: readonly string[];
};

/**
 * An approved user with a verified primary email and a complete
 * profile: the state the magic-link consume and registration paths
 * leave behind, which `loadPrincipal` requires. An approved user gets
 * `approvedAt` as approval sets it; the returned `email` is the
 * normalized address actually stored.
 */
export async function createUser({
  email = `user-${crypto.randomUUID()}@example.com`,
  profile = {},
  roles = [],
  ...overrides
}: CreateUserOptions = {}) {
  const db = getDb();
  const status = overrides.status ?? "approved";
  const [user] = await db
    .insert(schema.users)
    .values({
      id: `user_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      approvedAt: status === "approved" ? Temporal.Now.instant() : null,
      ...overrides,
      status,
    })
    .returning();
  await attachPrimaryEmail(user.id, email);
  if (profile !== false) {
    await db.insert(schema.profiles).values({
      fullName: "Test User",
      preferredName: "Test",
      phone: "+15135551212",
      ucAffiliation: "student",
      updatedAt: Temporal.Now.instant(),
      ...profile,
      userId: user.id,
    });
  }
  for (const roleId of roles) {
    await grantRole(user.id, roleId);
  }
  return { ...user, email: normalizeEmail(email) };
}

/** Idempotent, so a test can grant a role the user may already hold. */
export async function grantRole(userId: string, roleId: string) {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

export type CreateRoleOptions = Partial<RoleInsert> & {
  /** Permission ids (`perm_events_read_private`), which migrations seed. */
  permissions?: readonly string[];
};

/**
 * A role of the test's own, carrying exactly `permissions`.
 *
 * Prefer this to revoking a grant from a seeded role: storage isolation
 * is per file, so a deleted `role_permissions` row leaks into every
 * later test in the file.
 */
export async function createRole({
  permissions = [],
  ...overrides
}: CreateRoleOptions = {}) {
  const db = getDb();
  const suffix = crypto.randomUUID();
  const [role] = await db
    .insert(schema.roles)
    .values({
      id: `role_test_${suffix}`,
      name: `test_${suffix}`,
      displayName: "Test role",
      ...overrides,
    })
    .returning();
  for (const permissionId of permissions) {
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: role.id, permissionId });
  }
  return role;
}

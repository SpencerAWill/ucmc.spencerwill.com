import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

const { listLandingOfficers } =
  await import("#/features/landing/server/landing-officers.server");

// ── helpers ────────────────────────────────────────────────────────────

interface SeedUserOpts {
  email: string;
  status?: schema.UserStatus;
  preferredName?: string;
  withProfile?: boolean;
  avatarKey?: string | null;
}

async function seedUser(opts: SeedUserOpts): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: opts.status ?? "approved",
  });
  await attachPrimaryEmail(id, opts.email);
  if (opts.withProfile ?? true) {
    await db.insert(schema.profiles).values({
      userId: id,
      fullName: opts.preferredName ?? "Test User",
      preferredName: opts.preferredName ?? "Test",
      phone: "+15135551212",
      ucAffiliation: "student",
      avatarKey: opts.avatarKey ?? null,
      updatedAt: new Date(),
    });
  }
  return id;
}

async function seedRole(opts: {
  id: string;
  name: string;
  displayName: string;
  position: number;
  isOfficer: boolean;
}): Promise<void> {
  await getDb().insert(schema.roles).values(opts);
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  const db = getDb();
  // Per-file storage isolation: wipe anything we may have written. Audit
  // log isn't touched by this reader, but other join tables are.
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
  await db.delete(schema.auditLog);
  // Drop any test-created officer roles to keep `listLandingOfficers`
  // deterministic. Seeded officer roles (role_president, role_treasurer)
  // are flagged `is_officer = 1` by migration 0039; unflag them here so
  // the empty-case test sees an empty list.
  await db
    .delete(schema.roles)
    .where(
      inArray(schema.roles.id, [
        "role_test_president",
        "role_test_trip_lead",
        "role_test_secretary",
      ]),
    );
  await db
    .update(schema.roles)
    .set({ isOfficer: false })
    .where(eq(schema.roles.isOfficer, true));
});

// ── tests ──────────────────────────────────────────────────────────────

describe("listLandingOfficers", () => {
  it("returns an empty list when no role is flagged as officer", async () => {
    const userId = await seedUser({
      email: "noone@example.com",
      preferredName: "Nobody",
    });
    await assignRole(userId, "role_member");

    const result = await listLandingOfficers();

    expect(result).toEqual([]);
  });

  it("groups members by role and orders roles by position", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 0,
      isOfficer: true,
    });
    await seedRole({
      id: "role_test_secretary",
      name: "test_secretary",
      displayName: "Secretary",
      position: 1,
      isOfficer: true,
    });

    const prez = await seedUser({
      email: "prez@example.com",
      preferredName: "Alice",
    });
    const sec = await seedUser({
      email: "sec@example.com",
      preferredName: "Bob",
    });

    await assignRole(prez, "role_test_president");
    await assignRole(sec, "role_test_secretary");

    const result = await listLandingOfficers();

    expect(result.map((r) => r.roleId)).toEqual([
      "role_test_president",
      "role_test_secretary",
    ]);
    expect(result[0].displayName).toBe("President");
    expect(result[0].members.map((m) => m.preferredName)).toEqual(["Alice"]);
    expect(result[1].members.map((m) => m.preferredName)).toEqual(["Bob"]);
  });

  it("sorts members within a role by preferredName", async () => {
    await seedRole({
      id: "role_test_trip_lead",
      name: "test_trip_lead",
      displayName: "Trip Lead",
      position: 0,
      isOfficer: true,
    });
    const charlie = await seedUser({
      email: "c@example.com",
      preferredName: "Charlie",
    });
    const alice = await seedUser({
      email: "a@example.com",
      preferredName: "Alice",
    });
    const bob = await seedUser({
      email: "b@example.com",
      preferredName: "Bob",
    });
    await assignRole(charlie, "role_test_trip_lead");
    await assignRole(alice, "role_test_trip_lead");
    await assignRole(bob, "role_test_trip_lead");

    const result = await listLandingOfficers();

    expect(result).toHaveLength(1);
    expect(result[0].members.map((m) => m.preferredName)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("skips users whose status is not approved", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 0,
      isOfficer: true,
    });
    const pending = await seedUser({
      email: "pending@example.com",
      preferredName: "Pending",
      status: "pending",
    });
    const deactivated = await seedUser({
      email: "deactivated@example.com",
      preferredName: "Deactivated",
      status: "deactivated",
    });
    const approved = await seedUser({
      email: "approved@example.com",
      preferredName: "Real",
    });

    await assignRole(pending, "role_test_president");
    await assignRole(deactivated, "role_test_president");
    await assignRole(approved, "role_test_president");

    const result = await listLandingOfficers();

    expect(result).toHaveLength(1);
    expect(result[0].members.map((m) => m.preferredName)).toEqual(["Real"]);
  });

  it("skips users with no profile row (unclaimed stubs)", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 0,
      isOfficer: true,
    });
    // Officer pre-add path: user exists but no profiles row. Even if
    // their status were somehow "approved", the innerJoin on profiles
    // protects against leaking placeholder identities. We force
    // "approved" here to make the join the load-bearing guard.
    const stub = await seedUser({
      email: "stub@example.com",
      preferredName: "Stub",
      withProfile: false,
    });
    await assignRole(stub, "role_test_president");

    const result = await listLandingOfficers();

    expect(result).toEqual([]);
  });

  it("emits a row in each officer role a user holds", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 0,
      isOfficer: true,
    });
    await seedRole({
      id: "role_test_trip_lead",
      name: "test_trip_lead",
      displayName: "Trip Lead",
      position: 1,
      isOfficer: true,
    });
    const dualHat = await seedUser({
      email: "dual@example.com",
      preferredName: "Dana",
    });
    await assignRole(dualHat, "role_test_president");
    await assignRole(dualHat, "role_test_trip_lead");

    const result = await listLandingOfficers();

    expect(result.map((r) => r.displayName)).toEqual([
      "President",
      "Trip Lead",
    ]);
    expect(result.flatMap((r) => r.members.map((m) => m.userId))).toEqual([
      dualHat,
      dualHat,
    ]);
  });

  it("ignores roles that are not flagged as officer", async () => {
    await seedRole({
      id: "role_test_secretary",
      name: "test_secretary",
      displayName: "Secretary",
      position: 0,
      isOfficer: false,
    });
    const hidden = await seedUser({
      email: "hidden@example.com",
      preferredName: "Hidden",
    });
    await assignRole(hidden, "role_test_secretary");

    const result = await listLandingOfficers();

    expect(result).toEqual([]);
  });

  it("returns avatarKey when present and null when not", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 0,
      isOfficer: true,
    });
    const withAvatar = await seedUser({
      email: "withavatar@example.com",
      preferredName: "Anna",
      avatarKey: "avatars/anna/abc123.webp",
    });
    const noAvatar = await seedUser({
      email: "noavatar@example.com",
      preferredName: "Zed",
    });
    await assignRole(withAvatar, "role_test_president");
    await assignRole(noAvatar, "role_test_president");

    const result = await listLandingOfficers();

    expect(result[0].members).toEqual([
      {
        userId: withAvatar,
        preferredName: "Anna",
        avatarKey: "avatars/anna/abc123.webp",
      },
      { userId: noAvatar, preferredName: "Zed", avatarKey: null },
    ]);
  });
});

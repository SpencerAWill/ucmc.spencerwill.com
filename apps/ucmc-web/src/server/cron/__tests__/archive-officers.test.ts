import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

const { archiveCurrentOfficers, schoolYearForArchiveFire } =
  await import("#/server/cron/archive-officers.server");

// ── helpers ────────────────────────────────────────────────────────────

interface SeedUserOpts {
  email: string;
  fullName: string;
  status?: schema.UserStatus;
  withProfile?: boolean;
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
      fullName: opts.fullName,
      preferredName: opts.fullName.split(" ")[0] ?? opts.fullName,
      phone: "+15135551212",
      ucAffiliation: "student",
      avatarKey: null,
      updatedAt: Temporal.Now.instant(),
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
  await db.delete(schema.userRoles);
  await db.delete(schema.rolePermissions);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
  await db.delete(schema.auditLog);
  await db.delete(schema.historicalOfficers);
  // Mirror landing-officers.test.ts: nuke any test roles + clear the
  // is_officer flag from seeded officer roles so each test starts
  // from a clean officer set.
  await db
    .delete(schema.roles)
    .where(
      inArray(schema.roles.id, [
        "role_test_president",
        "role_test_treasurer",
        "role_test_secretary",
      ]),
    );
  await db
    .update(schema.roles)
    .set({ isOfficer: false })
    .where(eq(schema.roles.isOfficer, true));
});

// ── tests ──────────────────────────────────────────────────────────────

describe("schoolYearForArchiveFire", () => {
  it("encodes a March-1 fire as the just-completed academic year", () => {
    expect(
      schoolYearForArchiveFire(Temporal.Instant.from("2027-03-01T08:15:00Z")),
    ).toEqual({
      schoolYear: "2026-27",
      startYear: 2026,
    });
    expect(
      schoolYearForArchiveFire(Temporal.Instant.from("2030-03-01T08:15:00Z")),
    ).toEqual({
      schoolYear: "2029-30",
      startYear: 2029,
    });
  });

  it("zero-pads the trailing two-digit year across a century boundary", () => {
    // 1999-00 appears verbatim in the legacy seed; this is the case that
    // tripped the original Weebly page until 2009.
    expect(
      schoolYearForArchiveFire(Temporal.Instant.from("2000-03-01T08:15:00Z")),
    ).toEqual({
      schoolYear: "1999-00",
      startYear: 1999,
    });
    expect(
      schoolYearForArchiveFire(Temporal.Instant.from("2010-03-01T08:15:00Z")),
    ).toEqual({
      schoolYear: "2009-10",
      startYear: 2009,
    });
  });
});

describe("archiveCurrentOfficers", () => {
  it("returns skipped + no_officers when there are no current officers", async () => {
    const result = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );

    expect(result).toEqual({
      schoolYear: "2026-27",
      startYear: 2026,
      skipped: true,
      skipReason: "no_officers",
      rolesArchived: 0,
    });
    const rows = await getDb().select().from(schema.historicalOfficers);
    expect(rows).toHaveLength(0);
  });

  it("writes one row per role using displayName + position", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 1,
      isOfficer: true,
    });
    await seedRole({
      id: "role_test_treasurer",
      name: "test_treasurer",
      displayName: "Treasurer",
      position: 3,
      isOfficer: true,
    });
    const prez = await seedUser({
      email: "p@example.com",
      fullName: "Alice Smith",
    });
    const treas = await seedUser({
      email: "t@example.com",
      fullName: "Bob Jones",
    });
    await assignRole(prez, "role_test_president");
    await assignRole(treas, "role_test_treasurer");

    const result = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );

    expect(result).toEqual({
      schoolYear: "2026-27",
      startYear: 2026,
      skipped: false,
      rolesArchived: 2,
    });
    const rows = await getDb()
      .select()
      .from(schema.historicalOfficers)
      .orderBy(asc(schema.historicalOfficers.roleOrder));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      schoolYear: "2026-27",
      startYear: 2026,
      role: "President",
      roleOrder: 1,
      name: "Alice Smith",
    });
    expect(rows[1]).toMatchObject({
      schoolYear: "2026-27",
      startYear: 2026,
      role: "Treasurer",
      roleOrder: 3,
      name: "Bob Jones",
    });
  });

  it("flattens multi-holder roles into one row with ', '-joined names sorted by fullName", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 1,
      isOfficer: true,
    });
    // Two co-presidents — deliberately not assigned in alphabetical
    // order so the test catches "did we sort?" rather than
    // "did the insert order happen to match?".
    const charlie = await seedUser({
      email: "c@example.com",
      fullName: "Charlie Davis",
    });
    const alice = await seedUser({
      email: "a@example.com",
      fullName: "Alice Smith",
    });
    await assignRole(charlie, "role_test_president");
    await assignRole(alice, "role_test_president");

    const result = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );

    expect(result.rolesArchived).toBe(1);
    const rows = await getDb().select().from(schema.historicalOfficers);
    expect(rows).toHaveLength(1);
    // Sorted alphabetically by fullName, comma-joined per the legacy
    // co-holder convention.
    expect(rows[0]?.name).toBe("Alice Smith, Charlie Davis");
  });

  it("is idempotent: a second run for the same start_year skips with already_archived", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 1,
      isOfficer: true,
    });
    const prez = await seedUser({
      email: "p@example.com",
      fullName: "Alice Smith",
    });
    await assignRole(prez, "role_test_president");

    const first = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );
    expect(first.skipped).toBe(false);
    expect(first.rolesArchived).toBe(1);

    // Re-fire on the same March 1 (e.g. a Cloudflare retry) must NOT
    // duplicate rows or mutate the existing snapshot.
    const second = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );
    expect(second).toEqual({
      schoolYear: "2026-27",
      startYear: 2026,
      skipped: true,
      skipReason: "already_archived",
      rolesArchived: 0,
    });
    const rows = await getDb().select().from(schema.historicalOfficers);
    expect(rows).toHaveLength(1);
  });

  it("idempotency guard also protects manually pre-seeded years", async () => {
    // Officer adds a correction for 2026-27 by hand. Then the cron
    // fires on March 1 2027. The manual row must survive untouched.
    await getDb().insert(schema.historicalOfficers).values({
      schoolYear: "2026-27",
      startYear: 2026,
      role: "President",
      roleOrder: 1,
      name: "Manually Corrected Name",
    });

    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 1,
      isOfficer: true,
    });
    const prez = await seedUser({
      email: "p@example.com",
      fullName: "Different Name From DB",
    });
    await assignRole(prez, "role_test_president");

    const result = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );

    expect(result.skipReason).toBe("already_archived");
    const rows = await getDb().select().from(schema.historicalOfficers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Manually Corrected Name");
  });

  it("excludes non-officer roles, non-approved users, and users without profiles", async () => {
    await seedRole({
      id: "role_test_president",
      name: "test_president",
      displayName: "President",
      position: 1,
      isOfficer: true,
    });
    await seedRole({
      id: "role_test_secretary",
      name: "test_secretary",
      displayName: "Secretary",
      position: 4,
      // Not an officer role — must NOT be archived.
      isOfficer: false,
    });

    // Approved + has profile + officer role: included.
    const real = await seedUser({
      email: "real@example.com",
      fullName: "Real Officer",
    });
    await assignRole(real, "role_test_president");

    // Pending user with officer role: excluded.
    const pending = await seedUser({
      email: "pend@example.com",
      fullName: "Pending Officer",
      status: "pending",
    });
    await assignRole(pending, "role_test_president");

    // Approved but no profile (officer-pre-add stub): excluded.
    const stub = await seedUser({
      email: "stub@example.com",
      fullName: "Stub Officer",
      withProfile: false,
    });
    await assignRole(stub, "role_test_president");

    // Approved + profile + NON-officer role: excluded (role filter).
    const secretary = await seedUser({
      email: "sec@example.com",
      fullName: "Secretary Person",
    });
    await assignRole(secretary, "role_test_secretary");

    const result = await archiveCurrentOfficers(
      Temporal.Instant.from("2027-03-01T08:15:00Z"),
    );

    expect(result.rolesArchived).toBe(1);
    const rows = await getDb().select().from(schema.historicalOfficers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Real Officer");
    expect(rows[0]?.role).toBe("President");
  });
});

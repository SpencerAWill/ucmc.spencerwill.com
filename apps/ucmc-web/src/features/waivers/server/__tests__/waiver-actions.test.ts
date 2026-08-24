import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

// ── mocks ──────────────────────────────────────────────────────────────

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
}));

const {
  attestWaiverAction,
  bulkAttestWaiversAction,
  revokeWaiverAttestationAction,
  listMyWaiverHistoryAction,
  listMembersNeedingAttestationAction,
  listWaiverHistoryForUserAction,
  getMyCurrentWaiverStatusAction,
} = await import("#/features/waivers/server/waiver-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { status?: schema.UserStatus },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: opts?.status ?? "approved",
    approvedAt:
      opts?.status === "approved" || opts?.status === undefined
        ? Temporal.Now.instant()
        : null,
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  return id;
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsOfficer(): Promise<string> {
  const id = await seedUser("officer@example.com");
  await assignRole(id, "role_system_admin");
  await signInAs(id);
  return id;
}

async function signInAsMember(): Promise<string> {
  const id = await seedUser("member@example.com");
  await assignRole(id, "role_member");
  await signInAs(id);
  return id;
}

/**
 * A member holding `waivers:view` and NOT `waivers:verify` — the exec
 * tier migration 0064 added. Built as an ad-hoc role rather than reusing
 * a seeded one so the test pins the permission, not whatever grants
 * president/treasurer happen to carry.
 */
async function signInAsWaiverViewer(): Promise<string> {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: "role_test_waiver_viewer",
      name: "test_waiver_viewer",
      displayName: "Test waiver viewer",
      description: "Holds waivers:view without waivers:verify",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({
      roleId: "role_test_waiver_viewer",
      permissionId: "perm_waivers_view",
    })
    .onConflictDoNothing();
  const id = await seedUser("waiver-viewer@example.com");
  await assignRole(id, "role_test_waiver_viewer");
  await signInAs(id);
  return id;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

afterEach(() => {
  cookieJar.clear();
});

// ── authorization ──────────────────────────────────────────────────────

describe("waiver action authorization", () => {
  it("attestWaiverAction rejects unauthenticated callers", async () => {
    await expect(attestWaiverAction({ userId: "anyone" })).rejects.toThrow(
      "Not signed in",
    );
  });

  it("attestWaiverAction rejects members without waivers:verify", async () => {
    await signInAsMember();
    await expect(attestWaiverAction({ userId: "anyone" })).rejects.toThrow(
      "Forbidden: missing waivers:verify",
    );
  });

  it("revokeWaiverAttestationAction rejects members without waivers:verify", async () => {
    await signInAsMember();
    await expect(
      revokeWaiverAttestationAction({ attestationId: "wa_x", reason: "oops" }),
    ).rejects.toThrow("Forbidden: missing waivers:verify");
  });

  it("listMembersNeedingAttestationAction rejects members without waivers:view", async () => {
    await signInAsMember();
    await expect(listMembersNeedingAttestationAction()).rejects.toThrow(
      "Forbidden: missing waivers:view",
    );
  });

  it("listWaiverHistoryForUserAction rejects members without waivers:view", async () => {
    const target = await seedUser("target@example.com");
    await signInAsMember();
    await expect(
      listWaiverHistoryForUserAction({ userId: target }),
    ).rejects.toThrow("Forbidden: missing waivers:view");
  });

  // ── the waivers:view tier (migration 0064) ───────────────────────────

  it("waivers:view alone can read the attestation queue", async () => {
    const target = await seedUser("needs-waiver@example.com");
    await signInAsWaiverViewer();
    const queue = await listMembersNeedingAttestationAction();
    expect(queue.map((m) => m.userId)).toContain(target);
  });

  it("waivers:view alone can read another member's history", async () => {
    const target = await seedUser("target@example.com");
    await signInAsWaiverViewer();
    await expect(
      listWaiverHistoryForUserAction({ userId: target }),
    ).resolves.toEqual([]);
  });

  it("waivers:view alone cannot attest", async () => {
    const target = await seedUser("target@example.com");
    await signInAsWaiverViewer();
    await expect(attestWaiverAction({ userId: target })).rejects.toThrow(
      "Forbidden: missing waivers:verify",
    );
  });

  it("waivers:view alone cannot bulk-attest", async () => {
    const target = await seedUser("target@example.com");
    await signInAsWaiverViewer();
    await expect(
      bulkAttestWaiversAction({ userIds: [target] }),
    ).rejects.toThrow("Forbidden: missing waivers:verify");
  });

  it("waivers:view alone cannot revoke", async () => {
    await signInAsWaiverViewer();
    await expect(
      revokeWaiverAttestationAction({ attestationId: "wa_x", reason: "oops" }),
    ).rejects.toThrow("Forbidden: missing waivers:verify");
  });

  it("waivers:verify implies the read side (no explicit view grant needed)", async () => {
    // signInAsOfficer uses role_system_admin, which gets every
    // permission via the principal bypass — so assert the OR-check with
    // a role that holds verify and nothing else.
    const db = getDb();
    await db
      .insert(schema.roles)
      .values({
        id: "role_test_verify_only",
        name: "test_verify_only",
        displayName: "Test verifier",
        description: "Holds waivers:verify without waivers:view",
      })
      .onConflictDoNothing();
    await db
      .insert(schema.rolePermissions)
      .values({
        roleId: "role_test_verify_only",
        permissionId: "perm_waivers_verify",
      })
      .onConflictDoNothing();
    const id = await seedUser("verifier@example.com");
    await assignRole(id, "role_test_verify_only");
    await signInAs(id);
    await expect(listMembersNeedingAttestationAction()).resolves.toBeInstanceOf(
      Array,
    );
  });
});

// ── attest + history ───────────────────────────────────────────────────

describe("attestWaiverAction", () => {
  it("inserts an attestation row tied to the current cycle and version", async () => {
    const officer = await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");

    const { id } = await attestWaiverAction({
      userId: memberId,
      notes: "Paper waiver received at 9/2 meeting",
    });
    expect(id).toMatch(/^wa_/);

    const row = await getDb().query.waiverAttestations.findFirst({
      where: eq(schema.waiverAttestations.id, id),
    });
    expect(row).toBeDefined();
    expect(row?.userId).toBe(memberId);
    expect(row?.attestedBy).toBe(officer);
    expect(row?.cycle).toBe(currentWaiverCycle());
    expect(row?.version).toBe(WAIVER_VERSION);
    expect(row?.revokedAt).toBeNull();
    expect(row?.notes).toBe("Paper waiver received at 9/2 meeting");
  });

  it("rejects when target is not approved", async () => {
    await signInAsOfficer();
    const pendingId = await seedUser("pending@example.com", {
      status: "pending",
    });

    await expect(attestWaiverAction({ userId: pendingId })).rejects.toThrow(
      "Cannot attest a non-approved member",
    );
  });

  it("rejects when target user does not exist", async () => {
    await signInAsOfficer();
    await expect(
      attestWaiverAction({ userId: "user_does_not_exist" }),
    ).rejects.toThrow("Target user not found");
  });

  it("trims whitespace-only notes to null", async () => {
    await signInAsOfficer();
    const memberId = await seedUser("noteless@example.com");

    const { id } = await attestWaiverAction({
      userId: memberId,
      notes: "   ",
    });
    const row = await getDb().query.waiverAttestations.findFirst({
      where: eq(schema.waiverAttestations.id, id),
    });
    expect(row?.notes).toBeNull();
  });
});

describe("getMyCurrentWaiverStatusAction", () => {
  it("returns null when the caller has no attestation for the current cycle", async () => {
    await signInAsMember();
    const status = await getMyCurrentWaiverStatusAction();
    expect(status.cycle).toBe(currentWaiverCycle());
    expect(status.version).toBe(WAIVER_VERSION);
    expect(status.current).toBeNull();
  });

  it("returns the attesting officer when an attestation exists", async () => {
    const officer = await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");
    await attestWaiverAction({ userId: memberId });

    cookieJar.clear();
    await openSession(memberId);

    const status = await getMyCurrentWaiverStatusAction();
    expect(status.current).not.toBeNull();
    expect(status.current?.attestedByUserId).toBe(officer);
    expect(status.current?.cycle).toBe(currentWaiverCycle());
  });

  it("ignores revoked attestations", async () => {
    await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");
    const { id } = await attestWaiverAction({ userId: memberId });
    await revokeWaiverAttestationAction({
      attestationId: id,
      reason: "wrong member",
    });

    cookieJar.clear();
    await openSession(memberId);

    const status = await getMyCurrentWaiverStatusAction();
    expect(status.current).toBeNull();
  });
});

// ── bulk attest ────────────────────────────────────────────────────────

describe("bulkAttestWaiversAction", () => {
  it("attests multiple users in one call", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const b = await seedUser("b@example.com");
    const c = await seedUser("c@example.com");

    const { count } = await bulkAttestWaiversAction({ userIds: [a, b, c] });
    expect(count).toBe(3);

    const rows = await getDb().query.waiverAttestations.findMany();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([a, b, c]));
  });

  it("returns count 0 for an empty input without erroring", async () => {
    await signInAsOfficer();
    const result = await bulkAttestWaiversAction({ userIds: [] });
    expect(result.count).toBe(0);
  });

  it("aborts the whole batch if any target is non-approved", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const pending = await seedUser("p@example.com", { status: "pending" });

    await expect(
      bulkAttestWaiversAction({ userIds: [a, pending] }),
    ).rejects.toThrow("Cannot attest non-approved member");

    const rows = await getDb().query.waiverAttestations.findMany();
    expect(rows).toHaveLength(0);
  });

  it("de-duplicates repeated userIds in the same request", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const b = await seedUser("b@example.com");

    // `a` listed three times; the action should attest each member
    // exactly once and report a count of 2.
    const { count } = await bulkAttestWaiversAction({
      userIds: [a, a, b, a],
    });
    expect(count).toBe(2);

    const rows = await getDb().query.waiverAttestations.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([a, b]));
  });
});

// ── revoke + history ───────────────────────────────────────────────────

describe("revokeWaiverAttestationAction", () => {
  it("sets revokedAt/By/Reason without deleting the row", async () => {
    const officer = await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");
    const { id } = await attestWaiverAction({ userId: memberId });

    await revokeWaiverAttestationAction({
      attestationId: id,
      reason: "scanned wrong person's paper",
    });

    const row = await getDb().query.waiverAttestations.findFirst({
      where: eq(schema.waiverAttestations.id, id),
    });
    expect(row).toBeDefined();
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedBy).toBe(officer);
    expect(row?.revocationReason).toBe("scanned wrong person's paper");
  });

  it("rejects an already-revoked attestation", async () => {
    await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");
    const { id } = await attestWaiverAction({ userId: memberId });
    await revokeWaiverAttestationAction({ attestationId: id, reason: "x" });

    await expect(
      revokeWaiverAttestationAction({ attestationId: id, reason: "again" }),
    ).rejects.toThrow("already revoked");
  });

  it("requires a non-empty reason", async () => {
    await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");
    const { id } = await attestWaiverAction({ userId: memberId });

    await expect(
      revokeWaiverAttestationAction({ attestationId: id, reason: "   " }),
    ).rejects.toThrow("Revocation reason is required");
  });
});

// ── listMembersNeedingAttestationAction ────────────────────────────────

describe("listMembersNeedingAttestationAction", () => {
  it("returns approved members without a current attestation, oldest first", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const b = await seedUser("b@example.com");

    const list = await listMembersNeedingAttestationAction();
    const userIds = list.map((m) => m.userId);
    expect(userIds).toContain(a);
    expect(userIds).toContain(b);
  });

  it("excludes already-attested members for the current cycle", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const b = await seedUser("b@example.com");
    await attestWaiverAction({ userId: a });

    const list = await listMembersNeedingAttestationAction();
    const userIds = list.map((m) => m.userId);
    expect(userIds).not.toContain(a);
    expect(userIds).toContain(b);
  });

  it("re-includes a member whose attestation has been revoked", async () => {
    await signInAsOfficer();
    const a = await seedUser("a@example.com");
    const { id } = await attestWaiverAction({ userId: a });
    await revokeWaiverAttestationAction({ attestationId: id, reason: "oops" });

    const list = await listMembersNeedingAttestationAction();
    expect(list.map((m) => m.userId)).toContain(a);
  });

  it("excludes non-approved members", async () => {
    await signInAsOfficer();
    const pending = await seedUser("p@example.com", { status: "pending" });
    const list = await listMembersNeedingAttestationAction();
    expect(list.map((m) => m.userId)).not.toContain(pending);
  });
});

// ── listMyWaiverHistoryAction ──────────────────────────────────────────

describe("listMyWaiverHistoryAction", () => {
  it("returns the caller's attestations newest first", async () => {
    const officer = await signInAsOfficer();
    const memberId = await seedUser("attestee@example.com");

    const { id: first } = await attestWaiverAction({
      userId: memberId,
      notes: "first",
    });
    const { id: second } = await attestWaiverAction({
      userId: memberId,
      notes: "duplicate",
    });

    cookieJar.clear();
    await openSession(memberId);
    const history = await listMyWaiverHistoryAction();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe(second);
    expect(history[1]?.id).toBe(first);
    expect(history[0]?.attestedByUserId).toBe(officer);
  });
});

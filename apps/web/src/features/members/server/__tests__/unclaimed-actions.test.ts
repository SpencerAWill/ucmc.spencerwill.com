import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

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
  preAddUnclaimedMembersAction,
  editUnclaimedMemberAction,
  deleteUnclaimedMembersAction,
  listUnclaimedAction,
} = await import("#/features/members/server/unclaimed-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(
  email: string,
  opts?: { status?: schema.UserStatus },
): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: opts?.status ?? "approved",
    });
  await attachPrimaryEmail(id, email);
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

async function signInAsApprover(): Promise<string> {
  const userId = await seedUser("approver@example.com");
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

/**
 * Narrowing helper — the action's return type is a discriminated
 * `{ ok: true | false }` union, but most success-path tests destructure
 * `created` directly. Wrapping the call narrows the type and surfaces
 * a useful failure message if the action unexpectedly errors.
 */
async function preAddOk(args: { entries: { name: string; email: string }[] }) {
  const result = await preAddUnclaimedMembersAction(args);
  if (!result.ok) {
    throw new Error(`pre-add returned error: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function signInAsRegularMember(): Promise<string> {
  const userId = await seedUser("plain@example.com");
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
});

// ── authorization ──────────────────────────────────────────────────────

describe("authorization", () => {
  it("rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      preAddUnclaimedMembersAction({
        entries: [{ name: "Alice", email: "alice@uc.edu" }],
      }),
    ).rejects.toThrow("Not signed in");
  });

  it("rejects callers without members:manage", async () => {
    await signInAsRegularMember();
    await expect(
      preAddUnclaimedMembersAction({
        entries: [{ name: "Alice", email: "alice@uc.edu" }],
      }),
    ).rejects.toThrow("Forbidden: missing members:manage");
  });

  it("editUnclaimedMemberAction rejects callers without members:manage", async () => {
    await signInAsRegularMember();
    await expect(
      editUnclaimedMemberAction({
        userId: "user_x",
        name: "X",
        email: "x@uc.edu",
      }),
    ).rejects.toThrow("Forbidden: missing members:manage");
  });

  it("deleteUnclaimedMembersAction rejects callers without members:manage", async () => {
    await signInAsRegularMember();
    await expect(
      deleteUnclaimedMembersAction({ userIds: ["user_x"] }),
    ).rejects.toThrow("Forbidden: missing members:manage");
  });

  it("listUnclaimedAction rejects callers without members:manage", async () => {
    await signInAsRegularMember();
    await expect(listUnclaimedAction({})).rejects.toThrow(
      "Forbidden: missing members:manage",
    );
  });
});

// ── pre-add ────────────────────────────────────────────────────────────

describe("preAddUnclaimedMembersAction", () => {
  it("creates unclaimed users with placeholderName, unclaimedAt, and unverified email", async () => {
    const approverId = await signInAsApprover();
    const result = await preAddUnclaimedMembersAction({
      entries: [
        { name: "Alice Smith", email: "alice@uc.edu" },
        { name: "Bob Jones", email: "Bob@UC.edu" },
      ],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    expect(result.created[0]?.email).toBe("alice@uc.edu");
    expect(result.created[1]?.email).toBe("bob@uc.edu"); // normalized

    const db = getDb();
    const aliceUserId = result.created[0].userId;
    const aliceRow = await db.query.users.findFirst({
      where: eq(schema.users.id, aliceUserId),
    });
    expect(aliceRow?.status).toBe("unclaimed");
    expect(aliceRow?.placeholderName).toBe("Alice Smith");
    expect(aliceRow?.unclaimedAt).toBeInstanceOf(Temporal.Instant);

    const aliceEmail = await db.query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, aliceUserId),
    });
    expect(aliceEmail?.email).toBe("alice@uc.edu");
    expect(aliceEmail?.isPrimary).toBe(true);
    expect(aliceEmail?.verifiedAt).toBeNull();

    // Audit
    const events = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.pre_added"));
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.actorUserId).toBe(approverId);
      const meta = JSON.parse(event.metadataJson ?? "{}");
      expect(meta).toHaveProperty("email");
      expect(meta).toHaveProperty("placeholderName");
    }
  });

  it("skips an entry whose email already belongs to an existing user", async () => {
    await signInAsApprover();
    await seedUser("taken@uc.edu");
    const result = await preAddUnclaimedMembersAction({
      entries: [
        { name: "Carol", email: "carol@uc.edu" },
        { name: "Taken", email: "taken@uc.edu" },
      ],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.created.map((c) => c.email)).toEqual(["carol@uc.edu"]);
    expect(result.skipped).toEqual([
      { email: "taken@uc.edu", name: "Taken", reason: "email_taken" },
    ]);
  });

  it("skips later occurrences of a duplicate email within the same batch", async () => {
    await signInAsApprover();
    const result = await preAddUnclaimedMembersAction({
      entries: [
        { name: "Dan One", email: "dan@uc.edu" },
        { name: "Dan Two", email: "DAN@uc.edu" },
        { name: "Eli", email: "eli@uc.edu" },
      ],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.created.map((c) => c.email).sort()).toEqual([
      "dan@uc.edu",
      "eli@uc.edu",
    ]);
    expect(result.skipped).toEqual([
      { email: "dan@uc.edu", name: "Dan Two", reason: "duplicate_in_batch" },
    ]);
  });

  it("returns { ok: false, no_entries } for an empty entries list", async () => {
    await signInAsApprover();
    const result = await preAddUnclaimedMembersAction({ entries: [] });
    expect(result).toEqual({ ok: false, error: { kind: "no_entries" } });
  });

  it("returns { ok: false, too_many_entries } over the per-submit cap", async () => {
    await signInAsApprover();
    const entries = Array.from({ length: 201 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@uc.edu`,
    }));
    const result = await preAddUnclaimedMembersAction({ entries });
    expect(result).toEqual({
      ok: false,
      error: { kind: "too_many_entries", cap: 200, received: 201 },
    });
  });
});

// ── list ───────────────────────────────────────────────────────────────

describe("listUnclaimedAction", () => {
  it("returns unclaimed users only, with placeholderName and email", async () => {
    await signInAsApprover();
    await preAddUnclaimedMembersAction({
      entries: [{ name: "Frank", email: "frank@uc.edu" }],
    });
    // Approved user should not appear.
    await seedUser("plain@uc.edu", { status: "approved" });

    const result = await listUnclaimedAction({});
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      placeholderName: "Frank",
      email: "frank@uc.edu",
    });
  });
});

// ── edit ───────────────────────────────────────────────────────────────

describe("editUnclaimedMemberAction", () => {
  it("renames an unclaimed user", async () => {
    const approverId = await signInAsApprover();
    const { created } = await preAddOk({
      entries: [{ name: "Old Name", email: "old@uc.edu" }],
    });
    const target = created[0];
    const result = await editUnclaimedMemberAction({
      userId: target.userId,
      name: "New Name",
      email: "old@uc.edu",
    });
    expect(result).toEqual({ ok: true });

    const row = await getDb().query.users.findFirst({
      where: eq(schema.users.id, target.userId),
    });
    expect(row?.placeholderName).toBe("New Name");

    const events = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.unclaimed_edited"));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe(approverId);
  });

  it("changes the primary email", async () => {
    await signInAsApprover();
    const { created } = await preAddOk({
      entries: [{ name: "Renamed", email: "first@uc.edu" }],
    });
    const target = created[0];
    const result = await editUnclaimedMemberAction({
      userId: target.userId,
      name: "Renamed",
      email: "second@uc.edu",
    });
    expect(result).toEqual({ ok: true });

    const emailRow = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, target.userId),
    });
    expect(emailRow?.email).toBe("second@uc.edu");
  });

  it("returns email_taken when changing to an address owned by another user", async () => {
    await signInAsApprover();
    await seedUser("alreadyused@uc.edu");
    const { created } = await preAddOk({
      entries: [{ name: "X", email: "freeaddr@uc.edu" }],
    });
    const result = await editUnclaimedMemberAction({
      userId: created[0].userId,
      name: "X",
      email: "alreadyused@uc.edu",
    });
    expect(result).toEqual({ ok: false, error: { kind: "email_taken" } });
  });

  it("rejects edits on a non-unclaimed user", async () => {
    await signInAsApprover();
    const userId = await seedUser("approved@uc.edu", { status: "approved" });
    const result = await editUnclaimedMemberAction({
      userId,
      name: "X",
      email: "approved@uc.edu",
    });
    expect(result).toEqual({ ok: false, error: { kind: "not_unclaimed" } });
  });

  it("returns not_found for a missing userId", async () => {
    await signInAsApprover();
    const result = await editUnclaimedMemberAction({
      userId: "user_nonexistent",
      name: "X",
      email: "x@uc.edu",
    });
    expect(result).toEqual({ ok: false, error: { kind: "not_found" } });
  });
});

// ── delete ─────────────────────────────────────────────────────────────

describe("deleteUnclaimedMembersAction", () => {
  it("hard-deletes unclaimed users and cascades the user_emails row", async () => {
    const approverId = await signInAsApprover();
    const { created } = await preAddOk({
      entries: [
        { name: "Trash One", email: "t1@uc.edu" },
        { name: "Trash Two", email: "t2@uc.edu" },
      ],
    });
    const ids = created.map((c) => c.userId);
    const result = await deleteUnclaimedMembersAction({ userIds: ids });
    expect(result.deletedIds.sort()).toEqual([...ids].sort());

    const db = getDb();
    const remainingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.status, "unclaimed"));
    expect(remainingUsers).toHaveLength(0);

    const remainingEmails = await db
      .select()
      .from(schema.userEmails)
      .where(eq(schema.userEmails.email, "t1@uc.edu"));
    expect(remainingEmails).toHaveLength(0);

    const events = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.unclaimed_deleted"));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actorUserId === approverId)).toBe(true);
  });

  it("ignores ids whose status is not unclaimed", async () => {
    await signInAsApprover();
    const approvedId = await seedUser("approved@uc.edu");
    const { created } = await preAddOk({
      entries: [{ name: "U1", email: "u1@uc.edu" }],
    });
    const result = await deleteUnclaimedMembersAction({
      userIds: [approvedId, created[0].userId],
    });
    expect(result.deletedIds).toEqual([created[0].userId]);

    const stillThere = await getDb().query.users.findFirst({
      where: eq(schema.users.id, approvedId),
    });
    expect(stillThere?.status).toBe("approved");
  });

  it("returns an empty result for an empty userIds list", async () => {
    await signInAsApprover();
    const result = await deleteUnclaimedMembersAction({ userIds: [] });
    expect(result).toEqual({ deletedIds: [] });
  });
});

// ── claim flow integration ─────────────────────────────────────────────
// The full magic-link-to-claim integration lives with the auth tests
// (auth-flows.test.ts); this assertion is a smaller belt-and-suspenders
// check that the placeholder columns get NULLed when an unclaimed user
// row is updated to status="approved" by any path. Tests the FK schema,
// not the consume handler.

describe("claim integration (db-level invariants)", () => {
  it("placeholderName + unclaimedAt are nullable so a claim flip clears them", async () => {
    await signInAsApprover();
    const { created } = await preAddOk({
      entries: [{ name: "Claimer", email: "claimer@uc.edu" }],
    });
    const target = created[0];
    await getDb()
      .update(schema.users)
      .set({
        status: "approved",
        approvedAt: Temporal.Now.instant(),
        placeholderName: null,
        unclaimedAt: null,
      })
      .where(eq(schema.users.id, target.userId));

    const row = await getDb().query.users.findFirst({
      where: eq(schema.users.id, target.userId),
    });
    expect(row?.status).toBe("approved");
    expect(row?.placeholderName).toBeNull();
    expect(row?.unclaimedAt).toBeNull();
  });

  it("a stamped verifiedAt sticks once the unclaimed primary email is claimed", async () => {
    await signInAsApprover();
    const { created } = await preAddOk({
      entries: [{ name: "VA", email: "va@uc.edu" }],
    });
    const userId = created[0].userId;
    const at = Temporal.Instant.from("2026-01-15T00:00:00Z");
    await getDb()
      .update(schema.userEmails)
      .set({ verifiedAt: at })
      .where(
        and(
          eq(schema.userEmails.userId, userId),
          eq(schema.userEmails.isPrimary, true),
        ),
      );
    const row = await getDb().query.userEmails.findFirst({
      where: eq(schema.userEmails.userId, userId),
    });
    expect(row?.verifiedAt?.epochMilliseconds).toBe(at.epochMilliseconds);
  });
});

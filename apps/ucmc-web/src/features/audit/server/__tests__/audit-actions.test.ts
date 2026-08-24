import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionServer from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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

vi.mock("#/server/auth/session.server", async () => {
  const actual = await vi.importActual<typeof SessionServer>(
    "#/server/auth/session.server",
  );
  return {
    ...actual,
    loadCurrentPrincipal: vi.fn(actual.loadCurrentPrincipal),
  };
});

afterEach(async () => {
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function seedUser(): Promise<string> {
  const id = uid("u");
  await getDb().insert(schema.users).values({
    id,
    publicId: id,
    status: "approved",
  });
  await attachPrimaryEmail(id, `${id}@example.com`);
  return id;
}

async function asViewer(
  permissions: string[] = ["audit:view"],
): Promise<string> {
  const userId = await seedUser();
  const { loadCurrentPrincipal } = await import("#/server/auth/session.server");
  vi.mocked(loadCurrentPrincipal).mockResolvedValue({
    userId,
    primaryEmail: `${userId}@example.com`,
    emails: [`${userId}@example.com`],
    status: "approved",
    hasProfile: false,
    avatarKey: null,
    roles: [],
    isSystemAdmin: false,
    permissions,
    rolePermissionMap: {},
    roleDisplayNames: {},
  });
  return userId;
}

describe("listAuditEventsAction", () => {
  it("returns events newest-first with totalCount", async () => {
    await asViewer();
    const actor = await seedUser();
    // Insert three events with monotonically increasing timestamps so
    // we can assert ordering deterministically.
    await getDb()
      .insert(schema.auditLog)
      .values([
        {
          id: "audit_1",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        },
        {
          id: "audit_2",
          actorUserId: actor,
          action: "registration.rejected",
          createdAt: Temporal.Instant.from("2026-01-02T00:00:00Z"),
        },
        {
          id: "audit_3",
          actorUserId: actor,
          action: "member.deactivated",
          createdAt: Temporal.Instant.from("2026-01-03T00:00:00Z"),
        },
      ]);

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const result = await listAuditEventsAction({});

    expect(result.totalCount).toBe(3);
    expect(result.entries.map((e) => e.id)).toEqual([
      "audit_3",
      "audit_2",
      "audit_1",
    ]);
  });

  it("filters by action", async () => {
    await asViewer();
    const actor = await seedUser();
    await getDb()
      .insert(schema.auditLog)
      .values([
        {
          id: "audit_a",
          actorUserId: actor,
          action: "registration.approved",
        },
        {
          id: "audit_b",
          actorUserId: actor,
          action: "landing.faq_edited",
        },
      ]);

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const result = await listAuditEventsAction({
      action: "landing.faq_edited",
    });

    expect(result.totalCount).toBe(1);
    expect(result.entries.map((e) => e.action)).toEqual(["landing.faq_edited"]);
  });

  it("filters by date range (inclusive `from`, exclusive `to`)", async () => {
    await asViewer();
    const actor = await seedUser();
    await getDb()
      .insert(schema.auditLog)
      .values([
        {
          id: "audit_before",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: Temporal.Instant.from("2026-04-30T23:59:00Z"),
        },
        {
          id: "audit_in",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: Temporal.Instant.from("2026-05-01T12:00:00Z"),
        },
        {
          id: "audit_after",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: Temporal.Instant.from("2026-05-02T00:00:00Z"),
        },
      ]);

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const result = await listAuditEventsAction({
      from: Temporal.Instant.from("2026-05-01T00:00:00Z").epochMilliseconds,
      to: Temporal.Instant.from("2026-05-02T00:00:00Z").epochMilliseconds,
    });

    expect(result.totalCount).toBe(1);
    expect(result.entries.map((e) => e.id)).toEqual(["audit_in"]);
  });

  it("paginates with page + perPage", async () => {
    await asViewer();
    const actor = await seedUser();
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `audit_${String(i).padStart(3, "0")}`,
      actorUserId: actor,
      action: "registration.approved" as const,
      createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z").add({
        minutes: i,
      }),
    }));
    await getDb().insert(schema.auditLog).values(rows);

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const page1 = await listAuditEventsAction({ page: 1, perPage: 10 });
    const page2 = await listAuditEventsAction({ page: 2, perPage: 10 });
    const page3 = await listAuditEventsAction({ page: 3, perPage: 10 });

    expect(page1.totalCount).toBe(25);
    expect(page1.entries).toHaveLength(10);
    expect(page2.entries).toHaveLength(10);
    expect(page3.entries).toHaveLength(5);
    // No overlap between pages.
    const ids = new Set([
      ...page1.entries.map((e) => e.id),
      ...page2.entries.map((e) => e.id),
      ...page3.entries.map((e) => e.id),
    ]);
    expect(ids.size).toBe(25);
  });

  // Guards the pagination tiebreaker fix from PR #41 review:
  // `recordAuditEvents` writes bulk rows with the same default
  // `createdAt`, so without `desc(id)` as a secondary sort the
  // page boundary could re-order ties between requests and skip
  // or duplicate rows. With the tiebreaker, identical timestamps
  // are sorted by id (uuidv7-prefixed, sorts lex with createdAt).
  it("paginates stably across rows that share createdAt (id tiebreaker)", async () => {
    await asViewer();
    const actor = await seedUser();
    const sharedTimestamp = Temporal.Instant.from("2026-05-01T12:00:00Z");
    // 10 rows with identical timestamps. Use ids that wouldn't sort
    // in the same order as insertion to make the tiebreaker visible.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `audit_tie_${String(i).padStart(3, "0")}`,
      actorUserId: actor,
      action: "registration.approved" as const,
      createdAt: sharedTimestamp,
    }));
    await getDb().insert(schema.auditLog).values(rows);

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const page1 = await listAuditEventsAction({ page: 1, perPage: 4 });
    const page2 = await listAuditEventsAction({ page: 2, perPage: 4 });
    const page3 = await listAuditEventsAction({ page: 3, perPage: 4 });

    expect(page1.totalCount).toBe(10);
    expect(page1.entries).toHaveLength(4);
    expect(page2.entries).toHaveLength(4);
    expect(page3.entries).toHaveLength(2);

    const allIds = [
      ...page1.entries.map((e) => e.id),
      ...page2.entries.map((e) => e.id),
      ...page3.entries.map((e) => e.id),
    ];
    // No duplicates and no skipped rows. `[...allIds].sort(...)`
    // because `.sort()` mutates and we still need allIds in its
    // original page-traversal order for the next assertion.
    expect(new Set(allIds).size).toBe(10);
    expect([...allIds].sort()).toEqual(rows.map((r) => r.id).sort());

    // The order within tied rows is `desc(id)` — verify the page
    // boundaries sit at the right positions instead of the planner
    // returning rows in some other arbitrary order.
    const expectedOrder = [...rows]
      .map((r) => r.id)
      .sort()
      .reverse();
    expect(allIds).toEqual(expectedOrder);
  });

  it("rejects callers without audit:view", async () => {
    await asViewer([]); // no permissions

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    await expect(listAuditEventsAction({})).rejects.toThrow(/audit:view/);
  });

  it("joins actor + target preferred name when profiles exist", async () => {
    await asViewer();
    const actorId = await seedUser();
    const targetId = await seedUser();
    await getDb()
      .insert(schema.profiles)
      .values([
        {
          userId: actorId,
          fullName: "Alice Actor",
          preferredName: "Alice",
          phone: "+15555550001",
          ucAffiliation: "student",
        },
        {
          userId: targetId,
          fullName: "Bob Target",
          preferredName: "Bob",
          phone: "+15555550002",
          ucAffiliation: "student",
        },
      ]);
    await getDb().insert(schema.auditLog).values({
      id: "audit_join",
      actorUserId: actorId,
      action: "registration.approved",
      targetUserId: targetId,
    });

    const { listAuditEventsAction } =
      await import("#/features/audit/server/audit-actions.server");
    const result = await listAuditEventsAction({});

    expect(result.entries[0]?.actor?.preferredName).toBe("Alice");
    expect(result.entries[0]?.target?.preferredName).toBe("Bob");
  });
});

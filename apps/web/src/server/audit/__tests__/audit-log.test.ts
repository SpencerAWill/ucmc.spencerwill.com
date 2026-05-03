import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionServer from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";
import {
  recordAuditEvent,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";

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
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: id,
      email: `${id}@example.com`,
      status: "approved",
    });
  return id;
}

describe("recordAuditEvent", () => {
  it("inserts a row with the supplied fields", async () => {
    const actor = await seedUser();
    const target = await seedUser();

    await recordAuditEvent({
      actorUserId: actor,
      action: "registration.approved",
      targetUserId: target,
    });

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, actor));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("registration.approved");
    expect(rows[0]?.targetUserId).toBe(target);
    expect(rows[0]?.metadataJson).toBeNull();
  });

  it("JSON-serializes metadata", async () => {
    const actor = await seedUser();
    await recordAuditEvent({
      actorUserId: actor,
      action: "role.permissions_set",
      targetType: "role",
      targetId: "role_president",
      metadata: {
        permissionIds: ["perm_a", "perm_b"],
        note: "officer rotation",
      },
    });

    const [row] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, actor));
    expect(row.metadataJson).not.toBeNull();
    expect(JSON.parse(row.metadataJson ?? "")).toEqual({
      permissionIds: ["perm_a", "perm_b"],
      note: "officer rotation",
    });
  });

  it("supports null actor for system-initiated events", async () => {
    await recordAuditEvent({
      actorUserId: null,
      action: "member.self_deleted",
      metadata: { userId: "u_gone", email: "gone@example.com" },
    });

    const rows = await getDb().select().from(schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBeNull();
  });
});

describe("recordAuditEvents (bulk)", () => {
  it("inserts one row per input event", async () => {
    const actor = await seedUser();
    const t1 = await seedUser();
    const t2 = await seedUser();
    const t3 = await seedUser();

    await recordAuditEvents([
      { actorUserId: actor, action: "registration.approved", targetUserId: t1 },
      { actorUserId: actor, action: "registration.approved", targetUserId: t2 },
      { actorUserId: actor, action: "registration.approved", targetUserId: t3 },
    ]);

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, actor));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.targetUserId))).toEqual(
      new Set([t1, t2, t3]),
    );
  });

  it("is a no-op on empty input (no `INSERT ... VALUES ()` SQL error)", async () => {
    await expect(recordAuditEvents([])).resolves.toBeUndefined();
    const rows = await getDb().select().from(schema.auditLog);
    expect(rows).toHaveLength(0);
  });
});

describe("FK cascade on user delete (the SET NULL invariant)", () => {
  it("preserves the audit row when the actor is hard-deleted", async () => {
    const actor = await seedUser();
    const target = await seedUser();
    await recordAuditEvent({
      actorUserId: actor,
      action: "registration.approved",
      targetUserId: target,
    });

    // Delete the actor — schema FK is `ON DELETE SET NULL`.
    await getDb().delete(schema.users).where(eq(schema.users.id, actor));

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetUserId, target));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[0]?.action).toBe("registration.approved");
  });

  it("preserves the audit row when the target is hard-deleted", async () => {
    const actor = await seedUser();
    const target = await seedUser();
    await recordAuditEvent({
      actorUserId: actor,
      action: "member.deactivated",
      targetUserId: target,
    });

    await getDb().delete(schema.users).where(eq(schema.users.id, target));

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, actor));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetUserId).toBeNull();
  });
});

// ── viewer (listAuditEventsAction) ──────────────────────────────────────

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

async function asViewer(
  permissions: string[] = ["audit:view"],
): Promise<string> {
  const userId = await seedUser();
  const { loadCurrentPrincipal } = await import("#/server/auth/session.server");
  vi.mocked(loadCurrentPrincipal).mockResolvedValue({
    userId,
    email: `${userId}@example.com`,
    status: "approved",
    hasProfile: false,
    avatarKey: null,
    roles: [],
    permissions,
    rolePermissionMap: {},
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
          createdAt: new Date(2026, 0, 1),
        },
        {
          id: "audit_2",
          actorUserId: actor,
          action: "registration.rejected",
          createdAt: new Date(2026, 0, 2),
        },
        {
          id: "audit_3",
          actorUserId: actor,
          action: "member.deactivated",
          createdAt: new Date(2026, 0, 3),
        },
      ]);

    const { listAuditEventsAction } =
      await import("#/server/audit/audit-actions.server");
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
      await import("#/server/audit/audit-actions.server");
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
          createdAt: new Date("2026-04-30T23:59:00Z"),
        },
        {
          id: "audit_in",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: new Date("2026-05-01T12:00:00Z"),
        },
        {
          id: "audit_after",
          actorUserId: actor,
          action: "registration.approved",
          createdAt: new Date("2026-05-02T00:00:00Z"),
        },
      ]);

    const { listAuditEventsAction } =
      await import("#/server/audit/audit-actions.server");
    const result = await listAuditEventsAction({
      from: new Date("2026-05-01T00:00:00Z").getTime(),
      to: new Date("2026-05-02T00:00:00Z").getTime(),
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
      createdAt: new Date(2026, 0, 1, 0, i),
    }));
    await getDb().insert(schema.auditLog).values(rows);

    const { listAuditEventsAction } =
      await import("#/server/audit/audit-actions.server");
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

  it("rejects callers without audit:view", async () => {
    await asViewer([]); // no permissions

    const { listAuditEventsAction } =
      await import("#/server/audit/audit-actions.server");
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
      await import("#/server/audit/audit-actions.server");
    const result = await listAuditEventsAction({});

    expect(result.entries[0]?.actor?.preferredName).toBe("Alice");
    expect(result.entries[0]?.target?.preferredName).toBe("Bob");
  });
});

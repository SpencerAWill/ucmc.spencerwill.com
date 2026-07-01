import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";
import {
  buildAuditEventStatement,
  buildBulkAuditEventStatement,
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
  await getDb().insert(schema.users).values({
    id,
    publicId: id,
    status: "approved",
  });
  await attachPrimaryEmail(id, `${id}@example.com`);
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

describe("buildAuditEventStatement (atomic batch path)", () => {
  // The "build" helpers exist so callers can spread the audit INSERT
  // into their own `db.batch([...])` together with the parent
  // mutation. These tests exercise the atomicity contract: when a
  // statement in the batch fails, the audit row must NOT be left
  // behind, and when the batch succeeds, both the parent and the
  // audit row commit together.

  it("commits the audit row when the batch succeeds", async () => {
    const actor = await seedUser();
    const target = await seedUser();
    const db = getDb();

    // Mimic a real call site: parent UPDATE + audit INSERT, batched.
    await db.batch([
      db
        .update(schema.users)
        .set({ status: "rejected", rejectedAt: Temporal.Now.instant() })
        .where(eq(schema.users.id, target)),
      buildAuditEventStatement({
        actorUserId: actor,
        action: "registration.rejected",
        targetUserId: target,
      }),
    ]);

    const updatedTarget = await db.query.users.findFirst({
      where: eq(schema.users.id, target),
    });
    const auditRows = await db.select().from(schema.auditLog);
    expect(updatedTarget?.status).toBe("rejected");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("registration.rejected");
  });

  it("rolls back the audit row when a sibling statement in the batch fails", async () => {
    const actor = await seedUser();
    const target = await seedUser();
    const db = getDb();

    // Force a batch failure by writing an audit row with a duplicate
    // primary key. The parent UPDATE in the same batch must NOT
    // commit because D1 batches are atomic at the storage layer.
    const dupId = "audit_duplicate_id";
    await db.insert(schema.auditLog).values({
      id: dupId,
      actorUserId: actor,
      action: "registration.approved",
      createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    });

    const targetBeforeBatch = await db.query.users.findFirst({
      where: eq(schema.users.id, target),
    });
    const initialStatus = targetBeforeBatch?.status;

    await expect(
      db.batch([
        db
          .update(schema.users)
          .set({ status: "rejected", rejectedAt: Temporal.Now.instant() })
          .where(eq(schema.users.id, target)),
        // Drizzle insert with the colliding id; D1 will reject the
        // statement, which aborts the entire batch.
        db.insert(schema.auditLog).values({
          id: dupId,
          actorUserId: actor,
          action: "registration.rejected",
          createdAt: Temporal.Now.instant(),
        }),
      ]),
    ).rejects.toThrow();

    const targetAfter = await db.query.users.findFirst({
      where: eq(schema.users.id, target),
    });
    // Parent UPDATE must have rolled back along with the audit
    // INSERT — the whole point of the atomicity fix.
    expect(targetAfter?.status).toBe(initialStatus);

    // And only the original (pre-batch) audit row exists.
    const auditRows = await db.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.id).toBe(dupId);
    // The pre-existing row's action is the one we seeded, not the
    // one the batch tried to insert.
    expect(auditRows[0]?.action).toBe("registration.approved");
  });

  it("buildBulkAuditEventStatement returns null on empty input", () => {
    // Important contract: callers that compute events from a
    // `.returning()` result must be able to handle the empty case
    // without `db.batch` choking on a zero-row insert.
    expect(buildBulkAuditEventStatement([])).toBeNull();
  });

  it("buildBulkAuditEventStatement returns a single statement for many events", async () => {
    const actor = await seedUser();
    const t1 = await seedUser();
    const t2 = await seedUser();

    const stmt = buildBulkAuditEventStatement([
      { actorUserId: actor, action: "registration.approved", targetUserId: t1 },
      { actorUserId: actor, action: "registration.approved", targetUserId: t2 },
    ]);
    expect(stmt).not.toBeNull();
    await stmt!;

    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, actor));
    expect(rows).toHaveLength(2);
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

// Viewer tests for listAuditEventsAction live with the feature in
// `src/features/audit/server/__tests__/audit-actions.test.ts`. This file
// covers the recorder side (`recordAuditEvent`, the `build*` helpers,
// and FK cascade behavior) — those stay shared because every feature
// records events.

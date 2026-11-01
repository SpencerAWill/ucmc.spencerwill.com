import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { exportMyDataAction } =
  await import("#/features/auth/server/magic-link-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
    approvedAt: Temporal.Now.instant(),
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

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.conductReports);
  await db.delete(schema.conductRecords);
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.userRoles);
  await db.delete(schema.passkeyCredentials);
  await db.delete(schema.magicLinks);
  await db.delete(schema.emergencyContacts);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

afterEach(() => {
  cookieJar.clear();
});

// ── tests ──────────────────────────────────────────────────────────────

describe("exportMyDataAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(exportMyDataAction()).rejects.toThrow("Not signed in");
  });

  it("returns the caller's user, profile, and emergency contacts", async () => {
    const userId = await seedUser("export@example.com");
    const db = getDb();
    await db.insert(schema.emergencyContacts).values({
      id: `ec_${crypto.randomUUID()}`,
      userId,
      name: "Bob",
      phone: "+15135559999",
      relationship: "parent",
    });
    await signInAs(userId);

    const payload = await exportMyDataAction();

    expect(payload.user?.id).toBe(userId);
    expect(payload.emails).toHaveLength(1);
    expect(payload.emails[0]?.email).toBe("export@example.com");
    expect(payload.emails[0]?.isPrimary).toBe(true);
    expect(payload.profile?.preferredName).toBe("Test");
    expect(payload.emergencyContacts).toHaveLength(1);
    expect(payload.emergencyContacts[0]?.name).toBe("Bob");
  });

  it("includes role memberships and waiver attestation history", async () => {
    const userId = await seedUser("withhistory@example.com");
    const db = getDb();
    await db.insert(schema.userRoles).values({ userId, roleId: "role_member" });
    await db.insert(schema.waiverAttestations).values({
      id: `wa_${crypto.randomUUID()}`,
      userId,
      cycle: "2025-26",
      version: "v1",
      attestedAt: Temporal.Now.instant(),
      attestedBy: userId,
      notes: "First semester",
    });
    await signInAs(userId);

    const payload = await exportMyDataAction();

    expect(payload.roles).toContain("role_member");
    expect(payload.waiverAttestations).toHaveLength(1);
    expect(payload.waiverAttestations[0]?.cycle).toBe("2025-26");
    expect(payload.waiverAttestations[0]?.notes).toBe("First semester");
  });

  it("excludes passkey credentials even when the user has registered some", async () => {
    const userId = await seedUser("withpasskey@example.com");
    const db = getDb();
    await db.insert(schema.passkeyCredentials).values({
      id: `pk_${crypto.randomUUID()}`,
      userId,
      credentialId: "secret-credential-id",
      publicKey: "secret-public-key",
      counter: 5,
      transports: "internal",
      nickname: "iPhone",
    });
    await signInAs(userId);

    const payload = await exportMyDataAction();

    // No passkey-shaped key on the bundle, and the documented
    // exclusion list calls out the omission.
    expect(payload).not.toHaveProperty("passkeys");
    expect(payload).not.toHaveProperty("passkeyCredentials");
    expect(
      payload.excluded.some((s) => s.toLowerCase().includes("passkey")),
    ).toBe(true);

    // Round-trip through JSON.stringify to make sure no nested object
    // sneaks the secret credential id back into the dump.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret-credential-id");
    expect(serialized).not.toContain("secret-public-key");
  });

  it("excludes magic-link token hashes even when present", async () => {
    const userId = await seedUser("withmagic@example.com");
    const db = getDb();
    await db.insert(schema.magicLinks).values({
      tokenHash: "secret-token-hash",
      email: "withmagic@example.com",
      intent: "login",
      createdAt: Temporal.Now.instant(),
      expiresAt: Temporal.Now.instant().add({ milliseconds: 60_000 }),
    });
    await signInAs(userId);

    const payload = await exportMyDataAction();

    expect(payload).not.toHaveProperty("magicLinks");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret-token-hash");
    expect(
      payload.excluded.some((s) => s.toLowerCase().includes("magic")),
    ).toBe(true);
  });

  it("scopes results to the caller — does not leak other users' data", async () => {
    const meId = await seedUser("me@example.com");
    const otherId = await seedUser("other@example.com");
    const db = getDb();
    await db.insert(schema.emergencyContacts).values({
      id: `ec_${crypto.randomUUID()}`,
      userId: otherId,
      name: "Other's Mom",
      phone: "+15555550000",
      relationship: "parent",
    });
    await signInAs(meId);

    const payload = await exportMyDataAction();

    expect(payload.user?.id).toBe(meId);
    expect(payload.emails).toHaveLength(1);
    expect(payload.emails[0]?.email).toBe("me@example.com");
    expect(payload.emergencyContacts).toHaveLength(0);
    expect(JSON.stringify(payload)).not.toContain("Other's Mom");
  });

  it("includes a stable schemaVersion + ISO exportedAt", async () => {
    const userId = await seedUser("shape@example.com");
    await signInAs(userId);

    const payload = await exportMyDataAction();

    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.exportedAt).toBe("string");
    expect(() => new Date(payload.exportedAt).toISOString()).not.toThrow();
  });

  describe("conduct", () => {
    async function insertRecord(
      subjectUserId: string,
      values: Partial<typeof schema.conductRecords.$inferInsert> & {
        level: "note" | "warning" | "suspension";
      },
    ) {
      const id = `crec_${crypto.randomUUID()}`;
      await getDb()
        .insert(schema.conductRecords)
        .values({
          id,
          publicId: id,
          subjectUserId,
          subjectNameSnapshot: "Test User",
          ...values,
        });
    }

    it("exports the subject's own notices and nothing exec-only", async () => {
      const subject = await seedUser("subject@example.com");
      const reporter = await seedUser("reporter@example.com");
      await insertRecord(subject, {
        level: "note",
        internalNotes: "NOTE-TEXT-SECRET",
      });
      await insertRecord(subject, {
        level: "warning",
        memberStatement: "Please stop doing the thing.",
        internalNotes: "INTERNAL-NOTES-SECRET",
        sccsOutcomeNote: "SCCS-SECRET",
        startsOn: Temporal.PlainDate.from("2026-09-01"),
        liftedAt: Temporal.Instant.from("2026-10-01T12:00:00Z"),
        liftReason: "Resolved",
      });
      await getDb()
        .insert(schema.conductReports)
        .values({
          id: "crep_1",
          publicId: "crep_1",
          reporterUserId: reporter,
          subjectUserId: subject,
          occurredOn: Temporal.PlainDate.from("2026-08-30"),
          body: "REPORT-ABOUT-SUBJECT-SECRET",
        });
      await signInAs(subject);

      const payload = await exportMyDataAction();

      expect(payload.conductNotices).toEqual([
        {
          level: "warning",
          statement: "Please stop doing the thing.",
          startsOn: Temporal.PlainDate.from("2026-09-01"),
          endsOn: null,
          liftedAt: Temporal.Instant.from("2026-10-01T12:00:00Z"),
          liftReason: "Resolved",
        },
      ]);
      expect(payload.conductReportsFiled).toEqual([]);
      const serialized = JSON.stringify(payload);
      for (const secret of [
        "NOTE-TEXT-SECRET",
        "INTERNAL-NOTES-SECRET",
        "SCCS-SECRET",
        "REPORT-ABOUT-SUBJECT-SECRET",
        "reporterUserId",
        "internalNotes",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it("exports a reporter's own reports without triage fields", async () => {
      const reporter = await seedUser("filer@example.com");
      const subject = await seedUser("accused@example.com");
      await getDb()
        .insert(schema.conductReports)
        .values({
          id: "crep_2",
          publicId: "crep_2",
          reporterUserId: reporter,
          subjectUserId: subject,
          occurredOn: Temporal.PlainDate.from("2026-08-30"),
          location: "Red River Gorge",
          body: "What I saw.",
          status: "dismissed",
          dismissReason: "DISMISS-SECRET",
        });
      await signInAs(reporter);

      const payload = await exportMyDataAction();

      expect(payload.conductReportsFiled).toHaveLength(1);
      const filed = payload.conductReportsFiled[0];
      expect(Object.keys(filed).sort()).toEqual([
        "body",
        "createdAt",
        "location",
        "occurredOn",
      ]);
      expect(filed.body).toBe("What I saw.");
      expect(filed.location).toBe("Red River Gorge");
      expect(payload.conductNotices).toEqual([]);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("DISMISS-SECRET");
      expect(serialized).not.toContain("dismissed");
    });
  });
});

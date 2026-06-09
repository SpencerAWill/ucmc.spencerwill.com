import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  checkUploadRateLimit: async () => true,
}));

const {
  createGazetteIssueAction,
  deleteGazetteIssueAction,
  getGazetteIssueByPublicIdAction,
  getGazetteIssuesAction,
  updateGazetteIssueAction,
} = await import("#/features/gazette/server/gazette-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { getPublicBucket } = await import("#/server/r2");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
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

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

/**
 * Build a minimal-but-valid PDF dataUrl. Real PDFs start with the
 * `%PDF` magic header (4 bytes); the rest of the file is structurally
 * irrelevant for our validation path which only checks magic + size.
 * The `variant` byte makes it possible to produce two distinct
 * payloads with different content hashes, so the replace-on-update
 * test exercises both the put-new + delete-old branch.
 */
function makePdfDataUrl(variant = 0x01): string {
  const bytes = new Uint8Array([
    0x25,
    0x50,
    0x44,
    0x46, // %PDF
    0x2d,
    0x31,
    0x2e,
    0x34, // -1.4
    0x0a,
    0x25,
    variant,
    0x0a, // newline + comment byte + newline
    0x25,
    0x25,
    0x45,
    0x4f,
    0x46, // %%EOF
    0x0a,
  ]);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

const VALID_ISSUE = {
  schoolYear: "2026-27",
  startYear: 2026,
  issueNumber: 1,
  title: "Fall 2026 Issue",
  editor: "Test Editor",
  publishedAt: new Date("2026-10-15T00:00:00Z"),
  description: null,
};

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gazetteIssues);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);

  // Clear any R2 fixtures left over from prior tests.
  const bucket = getPublicBucket();
  let cursor: string | undefined;
  let truncated = true;
  while (truncated) {
    const page = await bucket.list({
      prefix: "gazette/",
      cursor,
      limit: 1000,
    });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((o) => o.key));
    }
    truncated = page.truncated;
    cursor = page.truncated ? page.cursor : undefined;
  }
});

// ── reads ──────────────────────────────────────────────────────────────

describe("getGazetteIssuesAction (read)", () => {
  it("returns an empty list when the archive is empty", async () => {
    const { issues } = await getGazetteIssuesAction();
    expect(issues).toEqual([]);
  });

  it("orders by start_year DESC, issue_number DESC", async () => {
    await signInAsAdmin();
    await createGazetteIssueAction({
      ...VALID_ISSUE,
      schoolYear: "2024-25",
      startYear: 2024,
      issueNumber: 1,
      pdfDataUrl: makePdfDataUrl(0x01),
    });
    await createGazetteIssueAction({
      ...VALID_ISSUE,
      schoolYear: "2026-27",
      startYear: 2026,
      issueNumber: 2,
      pdfDataUrl: makePdfDataUrl(0x02),
    });
    await createGazetteIssueAction({
      ...VALID_ISSUE,
      schoolYear: "2026-27",
      startYear: 2026,
      issueNumber: 1,
      pdfDataUrl: makePdfDataUrl(0x03),
    });

    const { issues } = await getGazetteIssuesAction();
    expect(issues.map((i) => `${i.schoolYear}#${i.issueNumber}`)).toEqual([
      "2026-27#2",
      "2026-27#1",
      "2024-25#1",
    ]);
  });
});

// ── create (public_gazette:manage) ─────────────────────────────────────

describe("createGazetteIssueAction", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      createGazetteIssueAction({
        ...VALID_ISSUE,
        pdfDataUrl: makePdfDataUrl(),
      }),
    ).rejects.toThrow(/not signed in/i);
  });

  it("rejects callers without public_gazette:manage", async () => {
    await signInAsMember();
    await expect(
      createGazetteIssueAction({
        ...VALID_ISSUE,
        pdfDataUrl: makePdfDataUrl(),
      }),
    ).rejects.toThrow(/public_gazette:manage/);
  });

  it("inserts the row, uploads the PDF, and emits an audit event", async () => {
    const actorId = await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(),
    });

    const row = await getGazetteIssueByPublicIdAction({ publicId });
    expect(row).not.toBeNull();
    expect(row!.schoolYear).toBe("2026-27");
    expect(row!.issueNumber).toBe(1);
    expect(row!.pdfKey).toMatch(/^gazette\/[0-9a-z-]+\/[a-f0-9]{16}\.pdf$/);
    expect(row!.pdfBytes).toBeGreaterThan(0);

    // R2 object exists.
    const bucket = getPublicBucket();
    const obj = await bucket.head(row!.pdfKey);
    expect(obj).not.toBeNull();

    // Audit row emitted with expected metadata.
    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gazette_issue.created"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBe(actorId);
    const meta = JSON.parse(auditRows[0].metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta.schoolYear).toBe("2026-27");
    expect(meta.issueNumber).toBe(1);
  });

  it("rejects payloads without the %PDF magic header", async () => {
    await signInAsAdmin();
    // Encode something that isn't a PDF — RIFF/WEBP header.
    const notPdf = `data:application/pdf;base64,${btoa("RIFF\x1a\x00\x00\x00WEBP")}`;
    await expect(
      createGazetteIssueAction({ ...VALID_ISSUE, pdfDataUrl: notPdf }),
    ).rejects.toThrow(/%PDF/);
  });

  it("surfaces the unique-index error on (school_year, issue_number) duplicates", async () => {
    await signInAsAdmin();
    await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(0x01),
    });
    await expect(
      createGazetteIssueAction({
        ...VALID_ISSUE,
        pdfDataUrl: makePdfDataUrl(0x02),
      }),
    ).rejects.toThrow();

    // Ensure the orphan PDF from the failed insert got cleaned up — no
    // gazette/ objects beyond the one row that succeeded. The cleanup
    // is fire-and-forget (.catch(() => {}) without awaiting), so give
    // it a beat to settle before listing.
    await new Promise((r) => setTimeout(r, 50));
    const bucket = getPublicBucket();
    const page = await bucket.list({ prefix: "gazette/" });
    expect(page.objects).toHaveLength(1);
  });
});

// ── update (public_gazette:manage) ─────────────────────────────────────

describe("updateGazetteIssueAction", () => {
  it("rejects callers without public_gazette:manage", async () => {
    await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(),
    });
    await signInAsMember();

    await expect(
      updateGazetteIssueAction({
        publicId,
        ...VALID_ISSUE,
        title: "New title",
      }),
    ).rejects.toThrow(/public_gazette:manage/);
  });

  it("metadata-only edit leaves the R2 object alone", async () => {
    await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(),
    });
    const before = await getGazetteIssueByPublicIdAction({ publicId });

    await updateGazetteIssueAction({
      publicId,
      ...VALID_ISSUE,
      title: "Renamed",
    });
    const after = await getGazetteIssueByPublicIdAction({ publicId });

    expect(after!.title).toBe("Renamed");
    expect(after!.pdfKey).toBe(before!.pdfKey);
    expect(after!.pdfBytes).toBe(before!.pdfBytes);

    // R2 object still there.
    const obj = await getPublicBucket().head(after!.pdfKey);
    expect(obj).not.toBeNull();
  });

  it("replacing the PDF uploads the new key and deletes the old one", async () => {
    await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(0x01),
    });
    const before = await getGazetteIssueByPublicIdAction({ publicId });

    await updateGazetteIssueAction({
      publicId,
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(0x02),
    });
    const after = await getGazetteIssueByPublicIdAction({ publicId });

    expect(after!.pdfKey).not.toBe(before!.pdfKey);

    // Old object should be gone (best-effort delete; wait briefly for
    // the fire-and-forget promise to settle).
    await new Promise((r) => setTimeout(r, 50));
    const oldObj = await getPublicBucket().head(before!.pdfKey);
    expect(oldObj).toBeNull();
    const newObj = await getPublicBucket().head(after!.pdfKey);
    expect(newObj).not.toBeNull();
  });
});

// ── delete (public_gazette:manage) ─────────────────────────────────────

describe("deleteGazetteIssueAction", () => {
  it("rejects callers without public_gazette:manage", async () => {
    await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(),
    });
    await signInAsMember();

    await expect(deleteGazetteIssueAction({ publicId })).rejects.toThrow(
      /public_gazette:manage/,
    );
  });

  it("removes the row, the R2 object, and writes an audit event", async () => {
    await signInAsAdmin();
    const { publicId } = await createGazetteIssueAction({
      ...VALID_ISSUE,
      pdfDataUrl: makePdfDataUrl(),
    });
    const row = await getGazetteIssueByPublicIdAction({ publicId });
    expect(row).not.toBeNull();

    await deleteGazetteIssueAction({ publicId });
    expect(await getGazetteIssueByPublicIdAction({ publicId })).toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    const obj = await getPublicBucket().head(row!.pdfKey);
    expect(obj).toBeNull();

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "gazette_issue.deleted"));
    expect(auditRows).toHaveLength(1);
  });
});

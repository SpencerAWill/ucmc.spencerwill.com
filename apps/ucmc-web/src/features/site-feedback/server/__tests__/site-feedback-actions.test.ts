import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import type * as RepoModule from "#/features/site-feedback/server/repo.server";
import { env } from "#/server/cloudflare-env";
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

const limits = vi.hoisted(() => ({ siteFeedback: true, upload: true }));
vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkSiteFeedbackRateLimit: async () => limits.siteFeedback,
  checkUploadRateLimit: async () => limits.upload,
}));

// Pass-through, so one test can make the insert fail after the upload.
vi.mock(
  "#/features/site-feedback/server/repo.server",
  async (importOriginal) => {
    const actual = await importOriginal<typeof RepoModule>();
    return { ...actual, insertSiteFeedback: vi.fn(actual.insertSiteFeedback) };
  },
);

const {
  listMySiteFeedbackAction,
  submitSiteFeedbackAction,
  getSiteFeedbackOverviewAction,
} =
  await import("#/features/site-feedback/server/site-feedback-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const repo = await import("#/features/site-feedback/server/repo.server");

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

async function signInAsBareUser(email = "bare@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await signInAs(userId);
  return userId;
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  limits.siteFeedback = true;
  limits.upload = true;
  const listed = await env.BUCKET_PRIVATE.list();
  if (listed.objects.length > 0) {
    await env.BUCKET_PRIVATE.delete(listed.objects.map((o) => o.key));
  }
  const db = getDb();
  await db.delete(schema.siteFeedback);
  await db.delete(schema.siteSettings);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── authorization ─────────────────────────────────────────────────────

describe("feedback authorization", () => {
  it("submitSiteFeedbackAction rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      submitSiteFeedbackAction({
        kind: "bug",
        title: "x",
        bugDescription: "y",
        stepsToReproduce: "z",
        expectedBehavior: "w",
      }),
    ).rejects.toThrow("Not signed in");
  });

  it("submitSiteFeedbackAction rejects users without site_feedback:submit", async () => {
    await signInAsBareUser();
    await expect(
      submitSiteFeedbackAction({
        kind: "bug",
        title: "x",
        bugDescription: "y",
        stepsToReproduce: "z",
        expectedBehavior: "w",
      }),
    ).rejects.toThrow("Forbidden: missing site_feedback:submit");
  });

  it("submitSiteFeedbackAction rejects when site_feedback.submissions_enabled is off", async () => {
    await signInAsMember();
    // Set the kill switch to false. `readSetting` falls back to the
    // schema default (true) when the row is absent, so we have to
    // write an explicit false row here.
    await getDb().insert(schema.siteSettings).values({
      key: "site_feedback.submissions_enabled",
      valueJson: "false",
      updatedBy: null,
    });
    await expect(
      submitSiteFeedbackAction({
        kind: "general",
        title: "After hours",
        body: "Anyone home?",
      }),
    ).rejects.toThrow("Site feedback submissions are currently disabled.");
    // No row written.
    expect(await getDb().select().from(schema.siteFeedback)).toHaveLength(0);
  });
});

// ── happy path ────────────────────────────────────────────────────────

describe("feedback lifecycle", () => {
  it("member can submit and list their own", async () => {
    const memberId = await signInAsMember();
    const { id } = await submitSiteFeedbackAction({
      kind: "bug",
      title: "Login button is hidden on mobile",
      bugDescription: "Sign-in form's primary button is offscreen on iOS.",
      stepsToReproduce: "Open the site on iPhone Safari, tap Sign in.",
      expectedBehavior: "The Sign in button should be visible.",
    });
    expect(id).toMatch(/^sfb_/);

    const mine = await listMySiteFeedbackAction();
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(id);
    expect(mine[0].kind).toBe("bug");
    expect(mine[0].status).toBe("open");
    expect(mine[0].createdBy).toBe(memberId);
    // Composed body uses Markdown section headings, not the raw input.
    expect(mine[0].body).toContain("**Describe the bug**");
    expect(mine[0].body).toContain("**Steps to reproduce**");
    expect(mine[0].body).toContain("**Expected behavior**");
    expect(mine[0].body).toContain(
      "Sign-in form's primary button is offscreen on iOS.",
    );
  });

  it("listMySiteFeedbackAction scopes to the caller, not other members", async () => {
    const memberA = await signInAsMember("a@example.com");
    await submitSiteFeedbackAction({
      kind: "general",
      title: "Hi from A",
      body: "Hello",
    });
    expect((await listMySiteFeedbackAction()).length).toBe(1);

    await signInAsMember("b@example.com");
    expect((await listMySiteFeedbackAction()).length).toBe(0);

    // Sanity: A's row is still in the DB.
    const total = await getDb().select().from(schema.siteFeedback);
    expect(total).toHaveLength(1);
    expect(total[0].createdBy).toBe(memberA);
  });

  it("normalizes pageUrl to origin+pathname before storing", async () => {
    await signInAsMember();
    const { id } = await submitSiteFeedbackAction({
      kind: "bug",
      title: "Strange thing",
      bugDescription: "Saw it on the callback page",
      stepsToReproduce: "Click the magic link in your inbox.",
      expectedBehavior: "Should land on the dashboard.",
      pageUrl: "https://app.example.com/auth/callback?token=secret#frag",
    });

    const row = await getDb().query.siteFeedback.findFirst({
      where: eq(schema.siteFeedback.id, id),
    });
    expect(row?.pageUrl).toBe("https://app.example.com/auth/callback");
  });

  it("stores null pageUrl when input is not a parseable URL", async () => {
    await signInAsMember();
    const { id } = await submitSiteFeedbackAction({
      kind: "general",
      title: "Hi",
      body: "Body",
      pageUrl: "not a url",
    });
    const row = await getDb().query.siteFeedback.findFirst({
      where: eq(schema.siteFeedback.id, id),
    });
    expect(row?.pageUrl).toBeNull();
  });

  it("submitSiteFeedbackAction makes no outbound request", async () => {
    await signInAsMember();
    // Configure the (retired) mirror's env so a reinstated mirror would
    // actually fire; with it unset the old code was a silent no-op.
    const priorToken = env.SITE_FEEDBACK_GITHUB_TOKEN;
    const priorRepo = env.SITE_FEEDBACK_GITHUB_REPO;
    env.SITE_FEEDBACK_GITHUB_TOKEN = "test-token";
    env.SITE_FEEDBACK_GITHUB_REPO = "example/repo";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 42,
          html_url: "https://github.com/example/repo/issues/42",
        }),
        { status: 201 },
      ),
    );
    try {
      await submitSiteFeedbackAction({
        kind: "general",
        title: "t",
        body: "b",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      const rows = await getDb().select().from(schema.siteFeedback);
      expect(rows[0]?.githubIssueNumber).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      if (priorToken === undefined) {
        delete env.SITE_FEEDBACK_GITHUB_TOKEN;
      } else {
        env.SITE_FEEDBACK_GITHUB_TOKEN = priorToken;
      }
      if (priorRepo === undefined) {
        delete env.SITE_FEEDBACK_GITHUB_REPO;
      } else {
        env.SITE_FEEDBACK_GITHUB_REPO = priorRepo;
      }
    }
  });
});

describe("getSiteFeedbackOverviewAction", () => {
  const bug = {
    kind: "bug" as const,
    title: "t",
    bugDescription: "d",
    stepsToReproduce: "s",
    expectedBehavior: "e",
  };

  it("gives a member their own counts and a null untriaged", async () => {
    await signInAsMember();
    await submitSiteFeedbackAction(bug);
    await submitSiteFeedbackAction(bug);
    expect(await getSiteFeedbackOverviewAction()).toEqual({
      mineOpen: 2,
      mineTracked: 0,
      untriaged: null,
    });
  });

  it("counts everyone's open rows for a manager", async () => {
    await signInAsMember("a@example.com");
    await submitSiteFeedbackAction(bug);
    await signInAsMember("b@example.com");
    await submitSiteFeedbackAction(bug);
    await signInAsAdmin();
    const overview = await getSiteFeedbackOverviewAction();
    expect(overview.untriaged).toBe(2);
    expect(overview.mineOpen).toBe(0);
  });

  it("rejects a caller with neither permission", async () => {
    await signInAsBareUser();
    await expect(getSiteFeedbackOverviewAction()).rejects.toThrow("Forbidden");
  });
});

// ── screenshots ───────────────────────────────────────────────────────

function dataUrl(type: string, bytes: number[]): string {
  return `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;
}

const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 7];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7];

function bugReport(screenshotDataUrl?: string) {
  return {
    kind: "bug" as const,
    title: "Broken",
    bugDescription: "It broke",
    stepsToReproduce: "Click",
    expectedBehavior: "Not broken",
    pageUrl: "https://ucmc.example/gear",
    screenshotDataUrl,
  };
}

async function privateKeys(): Promise<string[]> {
  const listed = await env.BUCKET_PRIVATE.list();
  return listed.objects.map((o) => o.key);
}

async function storedRow() {
  const [row] = await getDb().select().from(schema.siteFeedback);
  return row;
}

describe("submitSiteFeedbackAction screenshots", () => {
  it("stores a webp screenshot under site-feedback/screenshots/<id>.webp and records key and bytes", async () => {
    await signInAsMember();
    const { id } = await submitSiteFeedbackAction(
      bugReport(dataUrl("image/webp", WEBP)),
    );
    const key = `site-feedback/screenshots/${id}.webp`;
    expect(await privateKeys()).toEqual([key]);
    const object = await env.BUCKET_PRIVATE.get(key);
    expect(object?.httpMetadata?.contentType).toBe("image/webp");
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(
      new Uint8Array(WEBP),
    );
    const row = await storedRow();
    expect(row.screenshotKey).toBe(key);
    expect(row.screenshotBytes).toBe(WEBP.length);
  });

  it("accepts jpeg", async () => {
    await signInAsMember();
    const { id } = await submitSiteFeedbackAction(
      bugReport(dataUrl("image/jpeg", JPEG)),
    );
    expect(await privateKeys()).toEqual([
      `site-feedback/screenshots/${id}.jpg`,
    ]);
  });

  it("rejects png", async () => {
    await signInAsMember();
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/png", PNG))),
    ).rejects.toThrow("not an allowed image type");
    expect(await privateKeys()).toEqual([]);
    expect(await getDb().select().from(schema.siteFeedback)).toHaveLength(0);
  });

  it("rejects bytes that don't match the declared type", async () => {
    await signInAsMember();
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/webp", JPEG))),
    ).rejects.toThrow("do not match");
    expect(await privateKeys()).toEqual([]);
  });

  it("rejects more than 1 048 576 decoded bytes", async () => {
    await signInAsMember();
    const big = [...JPEG, ...Array<number>(1_048_577 - JPEG.length).fill(0)];
    // Built in chunks: spreading a million arguments overflows the stack.
    let binary = "";
    for (let i = 0; i < big.length; i += 8192) {
      binary += String.fromCharCode(...big.slice(i, i + 8192));
    }
    await expect(
      submitSiteFeedbackAction(
        bugReport(`data:image/jpeg;base64,${btoa(binary)}`),
      ),
    ).rejects.toThrow("exceeds 1048576 bytes");
    expect(await privateKeys()).toEqual([]);
  });

  it("writes nothing to R2 when submissions are disabled", async () => {
    await signInAsMember();
    await getDb().insert(schema.siteSettings).values({
      key: "site_feedback.submissions_enabled",
      valueJson: "false",
      updatedBy: null,
    });
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/webp", WEBP))),
    ).rejects.toThrow("disabled");
    expect(await privateKeys()).toEqual([]);
  });

  it("writes nothing to R2 when rate-limited", async () => {
    await signInAsMember();
    limits.siteFeedback = false;
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/webp", WEBP))),
    ).rejects.toThrow("Rate limit");
    expect(await privateKeys()).toEqual([]);
  });

  it("refuses when checkUploadRateLimit says no", async () => {
    await signInAsMember();
    limits.upload = false;
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/webp", WEBP))),
    ).rejects.toThrow("Too many screenshot uploads");
    expect(await privateKeys()).toEqual([]);
    expect(await getDb().select().from(schema.siteFeedback)).toHaveLength(0);
  });

  it("does not consult the upload budget without a screenshot", async () => {
    await signInAsMember();
    limits.upload = false;
    await expect(submitSiteFeedbackAction(bugReport())).resolves.toHaveProperty(
      "id",
    );
  });

  it("deletes the object when the insert fails", async () => {
    await signInAsMember();
    vi.mocked(repo.insertSiteFeedback).mockRejectedValueOnce(
      new Error("D1 down"),
    );
    await expect(
      submitSiteFeedbackAction(bugReport(dataUrl("image/webp", WEBP))),
    ).rejects.toThrow("D1 down");
    expect(await privateKeys()).toEqual([]);
  });

  it("submits without a screenshot exactly as before", async () => {
    await signInAsMember();
    await submitSiteFeedbackAction(bugReport());
    expect(await privateKeys()).toEqual([]);
    const row = await storedRow();
    expect(row.screenshotKey).toBeNull();
    expect(row.screenshotBytes).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkSiteFeedbackRateLimit: async () => true,
}));

const {
  listMySiteFeedbackAction,
  listAllSiteFeedbackAction,
  submitSiteFeedbackAction,
  updateSiteFeedbackStatusAction,
} =
  await import("#/features/site-feedback/server/site-feedback-actions.server");
const { openSession } = await import("#/server/auth/session.server");

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

  it("listAllSiteFeedbackAction rejects users without site_feedback:manage", async () => {
    await signInAsMember();
    await expect(listAllSiteFeedbackAction()).rejects.toThrow(
      "Forbidden: missing site_feedback:manage",
    );
  });

  it("updateSiteFeedbackStatusAction rejects users without site_feedback:manage", async () => {
    await signInAsMember();
    await expect(
      updateSiteFeedbackStatusAction({ id: "sfb_x", status: "resolved" }),
    ).rejects.toThrow("Forbidden: missing site_feedback:manage");
  });

  it("submitSiteFeedbackAction rejects when feedback.site_enabled is off", async () => {
    await signInAsMember();
    // Set the kill switch to false. `readSetting` falls back to the
    // schema default (true) when the row is absent, so we have to
    // write an explicit false row here.
    await getDb().insert(schema.siteSettings).values({
      key: "feedback.site_enabled",
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
    env.FEEDBACK_GITHUB_TOKEN = "test-token";
    env.FEEDBACK_GITHUB_REPO = "example/repo";
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
      delete env.FEEDBACK_GITHUB_TOKEN;
      delete env.FEEDBACK_GITHUB_REPO;
    }
  });

  it("admin lists all feedback across users and can update status", async () => {
    await signInAsMember("a@example.com");
    const a = await submitSiteFeedbackAction({
      kind: "bug",
      title: "From A",
      bugDescription: "Something",
      stepsToReproduce: "Steps",
      expectedBehavior: "Expected",
    });
    await signInAsMember("b@example.com");
    await submitSiteFeedbackAction({
      kind: "feature",
      title: "From B",
      problem: "Annoying thing",
      proposedSolution: "Less annoying thing",
    });

    await signInAsAdmin();
    const all = await listAllSiteFeedbackAction();
    expect(all).toHaveLength(2);

    await updateSiteFeedbackStatusAction({ id: a.id, status: "acknowledged" });
    const updated = await listAllSiteFeedbackAction();
    const aRow = updated.find((r) => r.id === a.id);
    expect(aRow?.status).toBe("acknowledged");
  });
});

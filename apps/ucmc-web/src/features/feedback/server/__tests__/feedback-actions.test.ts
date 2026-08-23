import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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
  checkFeedbackRateLimit: async () => true,
}));

// Default github mock — succeeds with a fake issue number. Tests that
// need to override use `vi.mocked(mirrorToGithub).mockResolvedValueOnce`
// or `mockRejectedValueOnce`.
vi.mock("#/features/feedback/server/github.server", () => ({
  mirrorToGithub: vi.fn(async () => ({
    number: 42,
    url: "https://github.com/example/repo/issues/42",
  })),
}));

const {
  listMyFeedbackAction,
  listAllFeedbackAction,
  submitFeedbackAction,
  updateFeedbackStatusAction,
} = await import("#/features/feedback/server/feedback-actions.server");
const { mirrorToGithub } =
  await import("#/features/feedback/server/github.server");
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
  vi.mocked(mirrorToGithub).mockReset();
  vi.mocked(mirrorToGithub).mockResolvedValue({
    number: 42,
    url: "https://github.com/example/repo/issues/42",
  });
  const db = getDb();
  await db.delete(schema.feedback);
  await db.delete(schema.siteSettings);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── authorization ─────────────────────────────────────────────────────

describe("feedback authorization", () => {
  it("submitFeedbackAction rejects unauthenticated callers", async () => {
    cookieJar.clear();
    await expect(
      submitFeedbackAction({
        kind: "bug",
        title: "x",
        bugDescription: "y",
        stepsToReproduce: "z",
        expectedBehavior: "w",
      }),
    ).rejects.toThrow("Not signed in");
  });

  it("submitFeedbackAction rejects users without site_feedback:submit", async () => {
    await signInAsBareUser();
    await expect(
      submitFeedbackAction({
        kind: "bug",
        title: "x",
        bugDescription: "y",
        stepsToReproduce: "z",
        expectedBehavior: "w",
      }),
    ).rejects.toThrow("Forbidden: missing site_feedback:submit");
  });

  it("listAllFeedbackAction rejects users without site_feedback:manage", async () => {
    await signInAsMember();
    await expect(listAllFeedbackAction()).rejects.toThrow(
      "Forbidden: missing site_feedback:manage",
    );
  });

  it("updateFeedbackStatusAction rejects users without site_feedback:manage", async () => {
    await signInAsMember();
    await expect(
      updateFeedbackStatusAction({ id: "fb_x", status: "resolved" }),
    ).rejects.toThrow("Forbidden: missing site_feedback:manage");
  });

  it("submitFeedbackAction rejects when feedback.site_enabled is off", async () => {
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
      submitFeedbackAction({
        kind: "general",
        title: "After hours",
        body: "Anyone home?",
      }),
    ).rejects.toThrow("Website feedback submissions are currently disabled.");
    // No row written, no mirror attempted.
    expect(await getDb().select().from(schema.feedback)).toHaveLength(0);
    expect(mirrorToGithub).not.toHaveBeenCalled();
  });
});

// ── happy path ────────────────────────────────────────────────────────

describe("feedback lifecycle", () => {
  it("member can submit and list their own", async () => {
    const memberId = await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "bug",
      title: "Login button is hidden on mobile",
      bugDescription: "Sign-in form's primary button is offscreen on iOS.",
      stepsToReproduce: "Open the site on iPhone Safari, tap Sign in.",
      expectedBehavior: "The Sign in button should be visible.",
    });
    expect(id).toMatch(/^fb_/);

    const mine = await listMyFeedbackAction();
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

  it("listMyFeedbackAction scopes to the caller, not other members", async () => {
    const memberA = await signInAsMember("a@example.com");
    await submitFeedbackAction({
      kind: "general",
      title: "Hi from A",
      body: "Hello",
    });
    expect((await listMyFeedbackAction()).length).toBe(1);

    await signInAsMember("b@example.com");
    expect((await listMyFeedbackAction()).length).toBe(0);

    // Sanity: A's row is still in the DB.
    const total = await getDb().select().from(schema.feedback);
    expect(total).toHaveLength(1);
    expect(total[0].createdBy).toBe(memberA);
  });

  it("populates githubIssueNumber/Url when the mirror returns a result", async () => {
    vi.mocked(mirrorToGithub).mockResolvedValueOnce({
      number: 1234,
      url: "https://github.com/example/repo/issues/1234",
    });

    await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "feature",
      title: "Dark mode for the trip planner",
      problem: "Trip planner is hard to read at night.",
      proposedSolution: "Add a dark mode toggle.",
    });

    const row = await getDb().query.feedback.findFirst({
      where: eq(schema.feedback.id, id),
    });
    expect(row?.githubIssueNumber).toBe(1234);
    expect(row?.githubIssueUrl).toBe(
      "https://github.com/example/repo/issues/1234",
    );
    // Mirror gets the same composed body that landed in D1.
    expect(mirrorToGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "**Describe the solution you'd like**",
        ) as string,
      }),
    );
  });

  it("still returns success when the mirror throws (fail-open contract)", async () => {
    vi.mocked(mirrorToGithub).mockRejectedValueOnce(new Error("GitHub 503"));

    await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "bug",
      title: "Another bug",
      bugDescription: "Something is wrong somewhere.",
      stepsToReproduce: "Repro steps go here.",
      expectedBehavior: "It should not be wrong.",
    });

    const row = await getDb().query.feedback.findFirst({
      where: eq(schema.feedback.id, id),
    });
    expect(row).toBeDefined();
    expect(row?.githubIssueNumber).toBeNull();
    expect(row?.githubIssueUrl).toBeNull();
  });

  it("normalizes pageUrl to origin+pathname before storing or mirroring", async () => {
    await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "bug",
      title: "Strange thing",
      bugDescription: "Saw it on the callback page",
      stepsToReproduce: "Click the magic link in your inbox.",
      expectedBehavior: "Should land on the dashboard.",
      pageUrl: "https://app.example.com/auth/callback?token=secret#frag",
    });

    const row = await getDb().query.feedback.findFirst({
      where: eq(schema.feedback.id, id),
    });
    expect(row?.pageUrl).toBe("https://app.example.com/auth/callback");

    expect(mirrorToGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        pageUrl: "https://app.example.com/auth/callback",
      }),
    );
  });

  it("stores null pageUrl when input is not a parseable URL", async () => {
    await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "general",
      title: "Hi",
      body: "Body",
      pageUrl: "not a url",
    });
    const row = await getDb().query.feedback.findFirst({
      where: eq(schema.feedback.id, id),
    });
    expect(row?.pageUrl).toBeNull();
  });

  it("leaves mirror columns null when the mirror is unconfigured (returns null)", async () => {
    vi.mocked(mirrorToGithub).mockResolvedValueOnce(null);

    await signInAsMember();
    const { id } = await submitFeedbackAction({
      kind: "general",
      title: "Just a quick note",
      body: "Thanks for the recent updates.",
    });

    const row = await getDb().query.feedback.findFirst({
      where: eq(schema.feedback.id, id),
    });
    expect(row?.githubIssueNumber).toBeNull();
    expect(row?.githubIssueUrl).toBeNull();
  });

  it("admin lists all feedback across users and can update status", async () => {
    await signInAsMember("a@example.com");
    const a = await submitFeedbackAction({
      kind: "bug",
      title: "From A",
      bugDescription: "Something",
      stepsToReproduce: "Steps",
      expectedBehavior: "Expected",
    });
    await signInAsMember("b@example.com");
    await submitFeedbackAction({
      kind: "feature",
      title: "From B",
      problem: "Annoying thing",
      proposedSolution: "Less annoying thing",
    });

    await signInAsAdmin();
    const all = await listAllFeedbackAction();
    expect(all).toHaveLength(2);

    await updateFeedbackStatusAction({ id: a.id, status: "acknowledged" });
    const updated = await listAllFeedbackAction();
    const aRow = updated.find((r) => r.id === a.id);
    expect(aRow?.status).toBe("acknowledged");
  });
});

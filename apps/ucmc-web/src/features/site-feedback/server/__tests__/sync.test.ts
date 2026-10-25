import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import type * as GithubModule from "#/features/site-feedback/server/github.server";
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

vi.mock(
  "#/features/site-feedback/server/github.server",
  async (importOriginal) => {
    const actual = await importOriginal<typeof GithubModule>();
    return {
      GithubError: actual.GithubError,
      getGithubConfig: vi.fn(),
      createIssue: vi.fn(),
      createComment: vi.fn(),
      getIssue: vi.fn(),
      findIssueByMarker: vi.fn(),
      getIssueStates: vi.fn(),
    };
  },
);

const github = await import("#/features/site-feedback/server/github.server");
const triage =
  await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
const sync = await import("#/features/site-feedback/server/sync.server");
const { log } = await import("#/server/log/log.server");
const { openSession } = await import("#/server/auth/session.server");

const cfg = { token: "tok", repo: "o/r" };

// ── helpers ────────────────────────────────────────────────────────────

async function seedAdmin(role = "role_system_admin"): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, "admin@example.com");
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  await db.insert(schema.userRoles).values({ userId: id, roleId: role });
  cookieJar.clear();
  await openSession(id);
  return id;
}

let seq = 0;

async function seedFeedback(body = "Body"): Promise<string> {
  seq += 1;
  const id = `sfb_gh${seq}`;
  const now = Temporal.Instant.fromEpochMilliseconds(
    Date.parse("2026-01-01T00:00:00Z") + seq * 1000,
  );
  await getDb()
    .insert(schema.siteFeedback)
    .values({
      id,
      kind: "bug",
      title: `Title ${seq}`,
      body,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function seedIssue(
  state: "draft" | "filing" | "open" | "closed",
  feedbackIds: string[],
  over: Partial<typeof schema.siteFeedbackIssues.$inferInsert> = {},
  quotedMd = "quoted",
): Promise<string> {
  seq += 1;
  const id = `sfi_gh${seq}`;
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.siteFeedbackIssues)
    .values({
      id,
      state,
      title: `Issue ${seq}`,
      summaryMd: "Summary",
      labels: ["bug", "feedback"],
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  for (const feedbackId of feedbackIds) {
    await getDb()
      .insert(schema.siteFeedbackIssueLinks)
      .values({ issueId: id, feedbackId, quotedMd, addedAt: now });
  }
  return id;
}

async function issueRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.siteFeedbackIssues)
    .where(eq(schema.siteFeedbackIssues.id, id));
  return row;
}

const mocked = {
  config: vi.mocked(github.getGithubConfig),
  states: vi.mocked(github.getIssueStates),
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(log, "error").mockImplementation(() => undefined);
  mocked.config.mockReturnValue(cfg);
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.siteFeedbackIssueLinks);
  await db.delete(schema.siteFeedbackIssues);
  await db.delete(schema.siteFeedback);
  await db.delete(schema.siteSettings);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── sync ───────────────────────────────────────────────────────────────

describe("runSiteFeedbackIssueSync", () => {
  it("closes issues GitHub reports closed or no longer finds", async () => {
    const a = await seedIssue("open", [], { githubNumber: 1 });
    const b = await seedIssue("open", [], { githubNumber: 2 });
    mocked.states.mockResolvedValue(
      new Map<number, "open" | "closed" | null>([
        [1, "closed"],
        [2, null],
      ]),
    );
    expect(await sync.runSiteFeedbackIssueSync()).toEqual({
      checked: 2,
      closed: 2,
    });
    for (const id of [a, b]) {
      const row = await issueRow(id);
      expect(row.state).toBe("closed");
      expect(row.githubSyncedAt).not.toBeNull();
    }
  });

  it("sync stamps closed_at on issues it closes and leaves open ones null", async () => {
    const closing = await seedIssue("open", [], { githubNumber: 1 });
    const staying = await seedIssue("open", [], { githubNumber: 2 });
    mocked.states.mockResolvedValue(
      new Map<number, "open" | "closed" | null>([
        [1, "closed"],
        [2, "open"],
      ]),
    );
    await sync.runSiteFeedbackIssueSync();
    expect((await issueRow(closing)).closedAt).not.toBeNull();
    expect((await issueRow(staying)).closedAt).toBeNull();
  });

  it("keeps open issues open and stamps the sync time", async () => {
    const a = await seedIssue("open", [], { githubNumber: 1 });
    mocked.states.mockResolvedValue(new Map([[1, "open"]]));
    expect(await sync.runSiteFeedbackIssueSync()).toEqual({
      checked: 1,
      closed: 0,
    });
    const row = await issueRow(a);
    expect(row.state).toBe("open");
    expect(row.githubSyncedAt).not.toBeNull();
  });

  it("does not ask about closed, draft or number-less issues", async () => {
    await seedIssue("closed", [], { githubNumber: 5 });
    await seedIssue("draft", []);
    await seedIssue("open", [], { githubNumber: null });
    await seedIssue("open", [], { githubNumber: 7 });
    mocked.states.mockResolvedValue(new Map([[7, "open"]]));
    await sync.runSiteFeedbackIssueSync();
    expect(mocked.states).toHaveBeenCalledWith(cfg, [7]);
  });

  it("makes no request when nothing is open", async () => {
    await seedIssue("closed", [], { githubNumber: 5 });
    expect(await sync.runSiteFeedbackIssueSync()).toEqual({
      checked: 0,
      closed: 0,
    });
    expect(mocked.states).not.toHaveBeenCalled();
  });

  it("resolves to null and logs when GitHub fails", async () => {
    const a = await seedIssue("open", [], { githubNumber: 1 });
    mocked.states.mockRejectedValue(new Error("boom"));
    expect(await sync.runSiteFeedbackIssueSync()).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      "site_feedback.sync_failed",
      expect.objectContaining({ error: "boom" }),
    );
    expect((await issueRow(a)).state).toBe("open");
  });

  it("is a no-op when GitHub isn't configured", async () => {
    await seedIssue("open", [], { githubNumber: 1 });
    mocked.config.mockReturnValue(null);
    expect(await sync.runSiteFeedbackIssueSync()).toBeNull();
    expect(mocked.states).not.toHaveBeenCalled();
  });

  it("batches a large number of open issues", async () => {
    const numbers = Array.from({ length: 150 }, (_, i) => i + 1);
    for (const n of numbers) {
      await seedIssue("open", [], { githubNumber: n });
    }
    mocked.states.mockResolvedValue(
      new Map(numbers.map((n) => [n, "closed" as const])),
    );
    expect(await sync.runSiteFeedbackIssueSync()).toEqual({
      checked: 150,
      closed: 150,
    });
  });
});

describe("syncSiteFeedbackIssuesAction", () => {
  it("returns ok with the counts for a manager", async () => {
    await seedAdmin();
    await seedIssue("open", [], { githubNumber: 1 });
    mocked.states.mockResolvedValue(new Map([[1, "closed"]]));
    expect(await triage.syncSiteFeedbackIssuesAction()).toEqual({
      ok: true,
      checked: 1,
      closed: 1,
    });
  });

  it("reports not_configured without a request", async () => {
    await seedAdmin();
    mocked.config.mockReturnValue(null);
    expect(await triage.syncSiteFeedbackIssuesAction()).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(mocked.states).not.toHaveBeenCalled();
  });

  it("lets a GitHub failure reach the caller", async () => {
    await seedAdmin();
    await seedIssue("open", [], { githubNumber: 1 });
    mocked.states.mockRejectedValue(new Error("boom"));
    await expect(triage.syncSiteFeedbackIssuesAction()).rejects.toThrow("boom");
  });

  it("rejects a non-manager", async () => {
    await seedAdmin("role_member");
    await expect(triage.syncSiteFeedbackIssuesAction()).rejects.toThrow(
      "Forbidden",
    );
    expect(mocked.states).not.toHaveBeenCalled();
  });

  it("resolves the submitter's report once its last open issue closes", async () => {
    const admin = await seedAdmin();
    const fb = await seedFeedback();
    await getDb()
      .update(schema.siteFeedback)
      .set({ createdBy: admin })
      .where(eq(schema.siteFeedback.id, fb));
    await seedIssue("open", [fb], { githubNumber: 1 });
    const before = await (
      await import("#/features/site-feedback/server/site-feedback-actions.server")
    ).listMySiteFeedbackAction();
    expect(before[0]?.state).toBe("tracked");
    mocked.states.mockResolvedValue(new Map([[1, "closed"]]));
    await triage.syncSiteFeedbackIssuesAction();
    const after = await (
      await import("#/features/site-feedback/server/site-feedback-actions.server")
    ).listMySiteFeedbackAction();
    expect(after[0]?.state).toBe("resolved");
  });
});

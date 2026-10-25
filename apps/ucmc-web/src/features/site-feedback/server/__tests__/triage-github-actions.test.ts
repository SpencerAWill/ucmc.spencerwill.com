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

async function linkRows(issueId: string) {
  return getDb()
    .select()
    .from(schema.siteFeedbackIssueLinks)
    .where(eq(schema.siteFeedbackIssueLinks.issueId, issueId));
}

const mocked = {
  config: vi.mocked(github.getGithubConfig),
  createIssue: vi.mocked(github.createIssue),
  createComment: vi.mocked(github.createComment),
  getIssue: vi.mocked(github.getIssue),
  findByMarker: vi.mocked(github.findIssueByMarker),
};

beforeEach(async () => {
  vi.resetAllMocks();
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

// ── filing ─────────────────────────────────────────────────────────────

describe("fileSiteFeedbackIssueAction", () => {
  it("a report's screenshot reaches GitHub as one line, never as a key or URL", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    await getDb()
      .update(schema.siteFeedback)
      .set({
        screenshotKey: `site-feedback/screenshots/${a}.webp`,
        screenshotBytes: 10,
      })
      .where(eq(schema.siteFeedback.id, a));
    const draft = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [a],
    });
    mocked.createIssue.mockResolvedValue({
      number: 77,
      url: "https://github.com/o/r/issues/77",
    });
    await triage.fileSiteFeedbackIssueAction({ id: draft.id });
    const payload = JSON.stringify(mocked.createIssue.mock.calls[0]);
    expect(payload).toContain("Screenshot attached (visible in triage).");
    expect(payload).not.toContain("site-feedback/screenshots/");
    expect(payload).not.toContain("/api/site-feedback/");
  });

  it("stores the number and URL, opens the issue and posts every link", async () => {
    const admin = await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const id = await seedIssue("draft", [a, b]);
    mocked.createIssue.mockResolvedValue({
      number: 42,
      url: "https://github.com/o/r/issues/42",
    });

    const res = await triage.fileSiteFeedbackIssueAction({ id });

    expect(res).toEqual({
      ok: true,
      number: 42,
      url: "https://github.com/o/r/issues/42",
    });
    const row = await issueRow(id);
    expect(row.state).toBe("open");
    expect(row.githubNumber).toBe(42);
    expect(row.githubUrl).toBe("https://github.com/o/r/issues/42");
    expect(row.filedBy).toBe(admin);
    expect(row.filedAt).not.toBeNull();
    expect(row.githubSyncedAt).not.toBeNull();
    expect((await linkRows(id)).every((l) => l.postedAt !== null)).toBe(true);
    const body = mocked.createIssue.mock.calls[0][1].body;
    expect(body).toContain("## Reports (2)");
    expect(body).toContain(`<!-- ucmc:${id} -->`);
  });

  it("marks posted only the reports composed into the body", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const late = await seedFeedback();
    const id = await seedIssue("draft", [a]);
    mocked.createIssue.mockImplementation(async () => {
      // A link that lands while GitHub is creating the issue.
      await getDb().insert(schema.siteFeedbackIssueLinks).values({
        issueId: id,
        feedbackId: late,
        quotedMd: "late",
        addedAt: Temporal.Now.instant(),
      });
      return { number: 43, url: "u" };
    });

    await triage.fileSiteFeedbackIssueAction({ id });

    const links = await linkRows(id);
    expect(links.find((l) => l.feedbackId === a)?.postedAt).not.toBeNull();
    expect(links.find((l) => l.feedbackId === late)?.postedAt).toBeNull();
  });

  it("refuses link, unlink and quote edits while the issue is filing", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const id = await seedIssue("filing", [a], {
      filingStartedAt: Temporal.Now.instant(),
    });
    const message = "This issue is being filed. Try again in a moment.";
    await expect(
      triage.linkSiteFeedbackAction({ issueId: id, feedbackIds: [b] }),
    ).rejects.toThrow(message);
    await expect(
      triage.unlinkSiteFeedbackAction({ issueId: id, feedbackId: a }),
    ).rejects.toThrow(message);
    await expect(
      triage.updateSiteFeedbackQuoteAction({
        issueId: id,
        feedbackId: a,
        quotedMd: "edited",
      }),
    ).rejects.toThrow(message);
    const links = await linkRows(id);
    expect(links).toHaveLength(1);
    expect(links[0].quotedMd).toBe("quoted");
  });

  it("passes a null summary as an empty string", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("draft", [a], { summaryMd: null });
    mocked.createIssue.mockResolvedValue({ number: 1, url: "u" });
    await triage.fileSiteFeedbackIssueAction({ id });
    expect(mocked.createIssue.mock.calls[0][1].body.startsWith("\n\n##")).toBe(
      true,
    );
  });

  it("makes exactly one createIssue call for two concurrent files", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("draft", [a]);
    mocked.createIssue.mockResolvedValue({ number: 7, url: "u" });

    const results = await Promise.all([
      triage.fileSiteFeedbackIssueAction({ id }),
      triage.fileSiteFeedbackIssueAction({ id }),
    ]);

    expect(mocked.createIssue).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const lost = results.find((r) => !r.ok);
    expect(lost).toMatchObject({ ok: false, reason: "already_filing" });
  });

  it("returns the draft to draft with the message on a definite 4xx", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("draft", [a]);
    mocked.createIssue.mockRejectedValue(
      new github.GithubError(422, "GitHub responded 422"),
    );

    const res = await triage.fileSiteFeedbackIssueAction({ id });

    expect(res).toEqual({
      ok: false,
      reason: "github_error",
      message: "GitHub refused the issue (422). Nothing was filed.",
    });
    const row = await issueRow(id);
    expect(row.state).toBe("draft");
    expect(row.filingStartedAt).toBeNull();
    expect((await linkRows(id))[0].postedAt).toBeNull();
  });

  it.each([
    ["a network failure", 0],
    ["a 5xx", 502],
    ["an unparseable 2xx", 201],
  ])(
    "keeps the claim on %s, since the issue may exist",
    async (_name, status) => {
      await seedAdmin();
      const a = await seedFeedback();
      const id = await seedIssue("draft", [a]);
      mocked.createIssue.mockRejectedValue(
        new github.GithubError(status, "unconfirmed"),
      );

      const res = await triage.fileSiteFeedbackIssueAction({ id });

      expect(res).toEqual({
        ok: false,
        reason: "github_error",
        message: `GitHub didn't confirm the issue (${status}). It may have been filed. Retry after 5 minutes to check.`,
      });
      const row = await issueRow(id);
      expect(row.state).toBe("filing");
      expect(row.filingStartedAt).not.toBeNull();
      expect((await linkRows(id))[0].postedAt).toBeNull();
    },
  );

  it("keeps a stale claim when the marker search itself fails with a 4xx", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("filing", [a], {
      filingStartedAt: Temporal.Now.instant().subtract({ minutes: 6 }),
    });
    mocked.findByMarker.mockRejectedValue(new github.GithubError(403, "no"));
    const res = await triage.fileSiteFeedbackIssueAction({ id });
    expect(res).toMatchObject({ ok: false, reason: "github_error" });
    expect(mocked.createIssue).not.toHaveBeenCalled();
    // Releasing to draft would make the next attempt "fresh" and skip the
    // marker search the earlier attempt may still need.
    expect((await issueRow(id)).state).toBe("filing");
  });

  it("rethrows anything that is not a GithubError", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("draft", [a]);
    mocked.createIssue.mockRejectedValue(new Error("boom"));
    await expect(triage.fileSiteFeedbackIssueAction({ id })).rejects.toThrow(
      "boom",
    );
    // The documented recovery path: the claim is left for the stale retry.
    expect((await issueRow(id)).state).toBe("filing");
  });

  it("adopts the issue a stale filing claim already created", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("filing", [a], {
      filingStartedAt: Temporal.Now.instant().subtract({ minutes: 6 }),
    });
    mocked.findByMarker.mockResolvedValue({ number: 99, url: "https://x/99" });

    const res = await triage.fileSiteFeedbackIssueAction({ id });

    expect(res).toEqual({ ok: true, number: 99, url: "https://x/99" });
    expect(mocked.findByMarker).toHaveBeenCalledWith(
      cfg,
      `<!-- ucmc:${id} -->`,
    );
    expect(mocked.createIssue).not.toHaveBeenCalled();
    const row = await issueRow(id);
    expect(row.state).toBe("open");
    expect(row.githubNumber).toBe(99);
    expect((await linkRows(id))[0].postedAt).not.toBeNull();
  });

  it("files normally when a stale claim finds no marker", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("filing", [a], {
      filingStartedAt: Temporal.Now.instant().subtract({ minutes: 6 }),
    });
    mocked.findByMarker.mockResolvedValue(null);
    mocked.createIssue.mockResolvedValue({ number: 5, url: "u" });
    const res = await triage.fileSiteFeedbackIssueAction({ id });
    expect(res).toMatchObject({ ok: true, number: 5 });
    expect(mocked.createIssue).toHaveBeenCalledTimes(1);
  });

  it("refuses a filing that started a minute ago", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("filing", [a], {
      filingStartedAt: Temporal.Now.instant().subtract({ minutes: 1 }),
    });
    const res = await triage.fileSiteFeedbackIssueAction({ id });
    expect(res).toMatchObject({ ok: false, reason: "already_filing" });
    expect(mocked.findByMarker).not.toHaveBeenCalled();
    expect(mocked.createIssue).not.toHaveBeenCalled();
    expect((await issueRow(id)).state).toBe("filing");
  });

  it("is too_long for 20 reports of 5,000 characters, with no claim made", async () => {
    await seedAdmin();
    const ids = [];
    for (let i = 0; i < 20; i += 1) {
      ids.push(await seedFeedback());
    }
    const id = await seedIssue("draft", ids, {}, "x".repeat(5000));

    const res = await triage.fileSiteFeedbackIssueAction({ id });

    expect(res).toMatchObject({ ok: false, reason: "too_long" });
    expect(res.ok ? "" : res.message).toMatch(
      /^Too long for one GitHub issue: unlink reports or trim their text \(\d{2,3},\d{3} \/ 65,000 characters\)$/,
    );
    const row = await issueRow(id);
    expect(row.state).toBe("draft");
    expect(row.filingStartedAt).toBeNull();
    expect(mocked.createIssue).not.toHaveBeenCalled();
  });

  it("returns no_reports for a draft with no links", async () => {
    await seedAdmin();
    const id = await seedIssue("draft", []);
    const res = await triage.fileSiteFeedbackIssueAction({ id });
    expect(res).toEqual({
      ok: false,
      reason: "no_reports",
      message: "Add at least one report before filing",
    });
    expect((await issueRow(id)).state).toBe("draft");
  });
});

// ── attaching ──────────────────────────────────────────────────────────

describe("attachSiteFeedbackToGithubIssueAction", () => {
  it("creates a row from GitHub and links the reports without posting", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    mocked.getIssue.mockResolvedValue({
      number: 12,
      url: "https://github.com/o/r/issues/12",
      title: "Hand made",
      state: "closed",
      isPullRequest: false,
    });

    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 12,
      feedbackIds: [a],
    });

    expect(res.ok).toBe(true);
    const issueId = res.ok ? res.issueId : "";
    expect(issueId).toMatch(/^sfi_/);
    const row = await issueRow(issueId);
    expect(row).toMatchObject({
      state: "closed",
      title: "Hand made",
      summaryMd: null,
      githubNumber: 12,
    });
    expect(row.githubSyncedAt).not.toBeNull();
    // Link-only: the maintainer reviews and posts from the composer.
    expect(mocked.createComment).not.toHaveBeenCalled();
    const links = await linkRows(issueId);
    expect(links).toHaveLength(1);
    expect(links[0].postedAt).toBeNull();
  });

  it("attaching a closed issue stamps closed_at", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    mocked.getIssue.mockResolvedValue({
      number: 13,
      url: "https://github.com/o/r/issues/13",
      title: "Done",
      state: "closed",
      isPullRequest: false,
    });
    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 13,
      feedbackIds: [a],
    });
    const row = await issueRow(res.ok ? res.issueId : "");
    expect(row.closedAt).not.toBeNull();
  });

  it("attaching an open issue leaves closed_at null", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    mocked.getIssue.mockResolvedValue({
      number: 14,
      url: "https://github.com/o/r/issues/14",
      title: "Open",
      state: "open",
      isPullRequest: false,
    });
    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 14,
      feedbackIds: [a],
    });
    const row = await issueRow(res.ok ? res.issueId : "");
    expect(row.closedAt).toBeNull();
  });

  it("re-attaching an already-closed issue keeps its first closed_at", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const firstClosed = Temporal.Instant.from("2026-01-01T00:00:00Z");
    const existing = await seedIssue("closed", [a], {
      githubNumber: 15,
      githubUrl: "https://github.com/o/r/issues/15",
      closedAt: firstClosed,
    });
    mocked.getIssue.mockResolvedValue({
      number: 15,
      url: "https://github.com/o/r/issues/15",
      title: "Done",
      state: "closed",
      isPullRequest: false,
    });
    await triage.attachSiteFeedbackToGithubIssueAction({
      number: 15,
      feedbackIds: [b],
    });
    const row = await issueRow(existing);
    expect(row.closedAt?.epochMilliseconds).toBe(firstClosed.epochMilliseconds);
  });

  it("re-attaching a reopened issue clears closed_at", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const existing = await seedIssue("closed", [a], {
      githubNumber: 16,
      githubUrl: "https://github.com/o/r/issues/16",
      closedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    });
    mocked.getIssue.mockResolvedValue({
      number: 16,
      url: "https://github.com/o/r/issues/16",
      title: "Back",
      state: "open",
      isPullRequest: false,
    });
    await triage.attachSiteFeedbackToGithubIssueAction({
      number: 16,
      feedbackIds: [b],
    });
    const row = await issueRow(existing);
    expect(row.state).toBe("open");
    expect(row.closedAt).toBeNull();
  });

  it("returns pull_request and creates no row for a PR", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    mocked.getIssue.mockResolvedValue({
      number: 3,
      url: "u",
      title: "PR",
      state: "open",
      isPullRequest: true,
    });
    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 3,
      feedbackIds: [a],
    });
    expect(res).toEqual({
      ok: false,
      reason: "pull_request",
      message: "#3 is a pull request, not an issue",
    });
    expect(await getDb().select().from(schema.siteFeedbackIssues)).toHaveLength(
      0,
    );
    expect(mocked.createComment).not.toHaveBeenCalled();
  });

  it("reuses the row already tracking that number", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const existing = await seedIssue("open", [a], {
      githubNumber: 20,
      githubUrl: "https://github.com/o/r/issues/20",
    });
    await getDb()
      .update(schema.siteFeedbackIssueLinks)
      .set({ postedAt: Temporal.Now.instant() });
    mocked.getIssue.mockResolvedValue({
      number: 20,
      url: "https://github.com/o/r/issues/20",
      title: "Whatever",
      state: "open",
      isPullRequest: false,
    });

    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 20,
      feedbackIds: [a, b],
    });

    expect(res).toEqual({ ok: true, issueId: existing });
    expect(await getDb().select().from(schema.siteFeedbackIssues)).toHaveLength(
      1,
    );
    const links = await linkRows(existing);
    expect(links).toHaveLength(2);
    // The new link waits, unposted, for "Post N new reports".
    expect(links.find((l) => l.feedbackId === b)?.postedAt).toBeNull();
    expect(links.find((l) => l.feedbackId === a)?.postedAt).not.toBeNull();
    expect(mocked.createComment).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown number", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    mocked.getIssue.mockResolvedValue(null);
    const res = await triage.attachSiteFeedbackToGithubIssueAction({
      number: 404,
      feedbackIds: [a],
    });
    expect(res).toEqual({
      ok: false,
      reason: "not_found",
      message: "No issue #404 in o/r",
    });
  });
});

// ── posting ────────────────────────────────────────────────────────────

describe("postPendingSiteFeedbackReportsAction", () => {
  it("posts once, then posts 0 without calling createComment", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const b = await seedFeedback();
    const issueId = await seedIssue("open", [a, b], {
      githubNumber: 30,
      githubUrl: "u",
    });

    const first = await triage.postPendingSiteFeedbackReportsAction({
      issueId,
    });
    const second = await triage.postPendingSiteFeedbackReportsAction({
      issueId,
    });

    expect(first).toEqual({ ok: true, posted: 2 });
    expect(second).toEqual({ ok: true, posted: 0 });
    expect(mocked.createComment).toHaveBeenCalledTimes(1);
  });

  it("is too_long when the comment would exceed GitHub's limit", async () => {
    await seedAdmin();
    const ids = [];
    for (let i = 0; i < 14; i += 1) {
      ids.push(await seedFeedback());
    }
    const issueId = await seedIssue(
      "open",
      ids,
      { githubNumber: 32, githubUrl: "u" },
      "x".repeat(5000),
    );
    const res = await triage.postPendingSiteFeedbackReportsAction({ issueId });
    expect(res).toMatchObject({ ok: false, reason: "too_long" });
    expect(res.ok ? "" : res.message).toMatch(
      /^Too long for one GitHub comment: unlink reports or trim their text \(\d{2},\d{3} \/ 65,000 characters\)$/,
    );
    expect(mocked.createComment).not.toHaveBeenCalled();
    expect((await linkRows(issueId)).every((l) => l.postedAt === null)).toBe(
      true,
    );
  });

  it("leaves links unposted when the comment is refused", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const issueId = await seedIssue("open", [a], {
      githubNumber: 31,
      githubUrl: "u",
    });
    mocked.createComment.mockRejectedValue(new github.GithubError(403, "no"));
    const res = await triage.postPendingSiteFeedbackReportsAction({ issueId });
    expect(res).toEqual({
      ok: false,
      reason: "github_error",
      message: "GitHub refused the comment (403). Nothing was posted.",
    });
    expect((await linkRows(issueId))[0].postedAt).toBeNull();
  });
});

// ── configuration ──────────────────────────────────────────────────────

describe("not configured", () => {
  it("is not_configured for all three actions", async () => {
    await seedAdmin();
    const a = await seedFeedback();
    const id = await seedIssue("draft", [a]);
    mocked.config.mockReturnValue(null);

    for (const res of [
      await triage.fileSiteFeedbackIssueAction({ id }),
      await triage.attachSiteFeedbackToGithubIssueAction({
        number: 1,
        feedbackIds: [a],
      }),
      await triage.postPendingSiteFeedbackReportsAction({ issueId: id }),
    ]) {
      expect(res).toMatchObject({ ok: false, reason: "not_configured" });
    }
    expect((await issueRow(id)).state).toBe("draft");
  });
});

// ── authorization ──────────────────────────────────────────────────────

describe("authorization", () => {
  it.each([
    [
      "fileSiteFeedbackIssueAction",
      (id: string) => triage.fileSiteFeedbackIssueAction({ id }),
    ],
    [
      "attachSiteFeedbackToGithubIssueAction",
      (_id: string, fb: string) =>
        triage.attachSiteFeedbackToGithubIssueAction({
          number: 1,
          feedbackIds: [fb],
        }),
    ],
    [
      "postPendingSiteFeedbackReportsAction",
      (id: string) =>
        triage.postPendingSiteFeedbackReportsAction({ issueId: id }),
    ],
  ])("%s rejects a role_member caller", async (_name, call) => {
    await seedAdmin("role_member");
    const fb = await seedFeedback();
    const id = await seedIssue("draft", [fb]);

    await expect(call(id, fb)).rejects.toThrow("Forbidden");

    expect(mocked.createIssue).not.toHaveBeenCalled();
    expect(mocked.createComment).not.toHaveBeenCalled();
    expect(mocked.getIssue).not.toHaveBeenCalled();
    expect(mocked.findByMarker).not.toHaveBeenCalled();
    expect((await issueRow(id)).state).toBe("draft");
  });
});

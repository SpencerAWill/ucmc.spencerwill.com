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
  checkSiteFeedbackRateLimit: async () => true,
}));

const { listMySiteFeedbackAction, getSiteFeedbackOverviewAction } =
  await import("#/features/site-feedback/server/site-feedback-actions.server");
const triage =
  await import("#/features/site-feedback/server/site-feedback-triage-actions.server");
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

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
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

let seq = 0;

async function seedFeedback(
  createdBy: string | null,
  over: Partial<typeof schema.siteFeedback.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const id = `sfb_seed${seq}`;
  const now = Temporal.Instant.fromEpochMilliseconds(
    Date.parse("2026-01-01T00:00:00Z") + seq * 1000,
  );
  await getDb()
    .insert(schema.siteFeedback)
    .values({
      id,
      kind: "bug",
      title: `Title ${seq}`,
      body: `Body ${seq}`,
      status: "open",
      createdBy,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  return id;
}

async function seedIssue(
  state: "draft" | "filing" | "open" | "closed",
  feedbackIds: string[],
  over: Partial<typeof schema.siteFeedbackIssues.$inferInsert> = {},
  posted = false,
): Promise<string> {
  seq += 1;
  const id = `sfi_seed${seq}`;
  const now = Temporal.Now.instant();
  await getDb()
    .insert(schema.siteFeedbackIssues)
    .values({
      id,
      state,
      title: `Issue ${seq}`,
      githubNumber: state === "draft" ? null : 1000 + seq,
      githubUrl:
        state === "draft"
          ? null
          : `https://github.com/o/r/issues/${1000 + seq}`,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  for (const feedbackId of feedbackIds) {
    await getDb()
      .insert(schema.siteFeedbackIssueLinks)
      .values({
        issueId: id,
        feedbackId,
        quotedMd: "quoted",
        postedAt: posted ? now : null,
        addedAt: now,
      });
  }
  return id;
}

async function stateOf(id: string): Promise<string | undefined> {
  const all = await triage.listSiteFeedbackTriageAction({ view: "new" });
  const other = await Promise.all(
    (["in_draft", "tracked", "closed"] as const).map((view) =>
      triage.listSiteFeedbackTriageAction({ view }),
    ),
  );
  return [all, ...other].flatMap((t) => t.rows).find((r) => r.id === id)?.state;
}

// ── authorization ─────────────────────────────────────────────────────

describe("triage authorization", () => {
  it("rejects a role_member caller on every action", async () => {
    const owner = await signInAsMember();
    const f = await seedFeedback(owner);
    const calls: Promise<unknown>[] = [
      triage.listSiteFeedbackTriageAction({ view: "new" }),
      triage.setSiteFeedbackDispositionAction({
        ids: [f],
        disposition: "resolved",
      }),
      triage.createSiteFeedbackIssueDraftAction({ feedbackIds: [f] }),
      triage.getSiteFeedbackIssueAction({ id: "sfi_x" }),
      triage.updateSiteFeedbackIssueDraftAction({
        id: "sfi_x",
        title: "t",
        summaryMd: "s",
        labels: [],
        expectedUpdatedAtMs: 0,
      }),
      triage.deleteSiteFeedbackIssueDraftAction({ id: "sfi_x" }),
      triage.linkSiteFeedbackAction({ issueId: "sfi_x", feedbackIds: [f] }),
      triage.unlinkSiteFeedbackAction({ issueId: "sfi_x", feedbackId: f }),
      triage.updateSiteFeedbackQuoteAction({
        issueId: "sfi_x",
        feedbackId: f,
        quotedMd: "q",
      }),
      triage.listRelatedSiteFeedbackAction({ issueId: "sfi_x" }),
    ];
    for (const call of calls) {
      await expect(call).rejects.toThrow("Forbidden");
    }
  });
});

// ── derived state ─────────────────────────────────────────────────────

describe("derived state", () => {
  it("derives one state per fixture", async () => {
    const owner = await signInAsMember("o@example.com");
    const unlinked = await seedFeedback(owner);
    const draftOnly = await seedFeedback(owner);
    await seedIssue("draft", [draftOnly]);
    const openIssue = await seedFeedback(owner);
    await seedIssue("open", [openIssue]);
    const oneClosed = await seedFeedback(owner);
    await seedIssue("closed", [oneClosed]);
    await seedIssue("open", [oneClosed]);
    const allClosed = await seedFeedback(owner);
    await seedIssue("closed", [allClosed]);
    const wontFix = await seedFeedback(owner, { status: "wont_fix" });
    const duplicate = await seedFeedback(owner, { status: "duplicate" });
    const resolved = await seedFeedback(owner, { status: "resolved" });
    const acknowledged = await seedFeedback(owner, { status: "acknowledged" });
    const legacyClosed = await seedFeedback(owner, { status: "closed" });
    const draftAndClosed = await seedFeedback(owner);
    await seedIssue("draft", [draftAndClosed]);
    await seedIssue("closed", [draftAndClosed]);

    await signInAsAdmin();
    const expected: [string, string][] = [
      [unlinked, "new"],
      [draftOnly, "in_draft"],
      [openIssue, "tracked"],
      [oneClosed, "tracked"],
      [allClosed, "resolved"],
      [wontFix, "wont_fix"],
      [duplicate, "duplicate"],
      [resolved, "resolved"],
      [acknowledged, "new"],
      [legacyClosed, "wont_fix"],
      [draftAndClosed, "resolved"],
    ];
    for (const [id, state] of expected) {
      expect([id, await stateOf(id)]).toEqual([id, state]);
    }
  });

  it("shows a submitter in_draft as new and trackedIn without drafts", async () => {
    const owner = await signInAsMember("o@example.com");
    const draftOnly = await seedFeedback(owner);
    await seedIssue("draft", [draftOnly]);
    const filed = await seedFeedback(owner);
    const open = await seedIssue("open", [filed]);
    const both = await seedFeedback(owner);
    await seedIssue("draft", [both]);
    await seedIssue("open", [both]);
    void open;

    const mine = await listMySiteFeedbackAction();
    const byId = new Map(mine.map((m) => [m.id, m]));
    expect(byId.get(draftOnly)?.state).toBe("new");
    expect(byId.get(draftOnly)?.trackedIn).toEqual([]);
    expect(byId.get(filed)?.state).toBe("tracked");
    expect(byId.get(filed)?.trackedIn).toHaveLength(1);
    expect(byId.get(filed)?.trackedIn[0]?.url).toMatch(/^https:\/\/github/);
    expect(byId.get(both)?.trackedIn).toHaveLength(1);

    expect(await getSiteFeedbackOverviewAction()).toEqual({
      mineOpen: 1,
      mineTracked: 2,
      untriaged: null,
    });
  });
});

// ── list ──────────────────────────────────────────────────────────────

describe("getSiteFeedbackIssueAction screenshots", () => {
  it("each link carries its report's screenshot state, not the key", async () => {
    const owner = await seedUser("o@example.com");
    const shot = await seedFeedback(owner, {
      screenshotKey: "site-feedback/screenshots/sfb_y.webp",
    });
    const plain = await seedFeedback(owner);
    const id = await seedIssue("draft", [shot, plain]);
    await signInAsAdmin();
    const detail = await triage.getSiteFeedbackIssueAction({ id });
    expect(
      Object.fromEntries(detail.links.map((l) => [l.feedbackId, l.screenshot])),
    ).toEqual({ [shot]: "present", [plain]: null });
    expect(JSON.stringify(detail)).not.toContain("site-feedback/screenshots/");
  });
});

describe("listSiteFeedbackTriageAction", () => {
  it("reports each row's screenshot state without its key", async () => {
    const owner = await signInAsMember("o@example.com");
    const shot = await seedFeedback(owner, {
      screenshotKey: "site-feedback/screenshots/sfb_x.webp",
      screenshotBytes: 10,
    });
    const gone = await seedFeedback(owner, {
      screenshotPurgedAt: Temporal.Now.instant(),
    });
    const plain = await seedFeedback(owner);
    await signInAsAdmin();
    const res = await triage.listSiteFeedbackTriageAction({ view: "new" });
    const state = new Map(res.rows.map((r) => [r.id, r.screenshot]));
    expect(state.get(shot)).toBe("present");
    expect(state.get(gone)).toBe("purged");
    expect(state.get(plain)).toBeNull();
    expect(JSON.stringify(res)).not.toContain("site-feedback/screenshots/");
  });

  it("narrows by q and reports counts, drafts and config", async () => {
    const owner = await signInAsMember("o@example.com");
    const a = await seedFeedback(owner, { title: "Broken on iPhone" });
    await seedFeedback(owner, { title: "Something else" });
    const d = await seedFeedback(owner);
    const draft = await seedIssue("draft", [d]);
    await seedIssue("open", [a], { title: "Open one" });
    await signInAsAdmin();
    const all = await triage.listSiteFeedbackTriageAction({ view: "new" });
    expect(all.rows).toHaveLength(1);
    expect(all.counts).toEqual({
      new: 1,
      in_draft: 1,
      tracked: 1,
      closed: 0,
    });
    expect(all.drafts.map((x) => x.id)).toEqual([draft]);
    expect(all.drafts[0]).toMatchObject({ reportCount: 1, unpostedCount: 1 });
    expect(all.openIssues).toHaveLength(1);
    expect(all.githubConfigured).toBe(false);
    expect(all.lastSyncedAt).toBeNull();

    const tracked = await triage.listSiteFeedbackTriageAction({
      view: "tracked",
      q: "iphone",
    });
    expect(tracked.rows.map((r) => r.id)).toEqual([a]);
    expect(tracked.rows[0]?.issues[0]?.githubNumber).toBeGreaterThan(1000);
    const none = await triage.listSiteFeedbackTriageAction({
      view: "new",
      q: "iphone",
    });
    expect(none.rows).toEqual([]);
  });

  it("lists a deleted author with a null public id", async () => {
    const owner = await signInAsMember("o@example.com");
    await seedFeedback(owner);
    await getDb().delete(schema.users).where(eq(schema.users.id, owner));
    await signInAsAdmin();
    const res = await triage.listSiteFeedbackTriageAction({ view: "new" });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.createdByPublicId).toBeNull();
  });
});

// ── dispositions ──────────────────────────────────────────────────────

describe("setSiteFeedbackDispositionAction", () => {
  it("updates 150 rows", async () => {
    const owner = await seedUser("o@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      ids.push(await seedFeedback(owner));
    }
    await signInAsAdmin();
    const res = await triage.setSiteFeedbackDispositionAction({
      ids,
      disposition: "wont_fix",
    });
    expect(res).toEqual({ updated: 150 });
    const rows = await getDb().select().from(schema.siteFeedback);
    expect(rows.every((r) => r.status === "wont_fix")).toBe(true);
  });

  it("skips reports linked to an issue and counts only real changes", async () => {
    const owner = await seedUser("o@example.com");
    const free = await seedFeedback(owner);
    const drafted = await seedFeedback(owner);
    const tracked = await seedFeedback(owner);
    await seedIssue("draft", [drafted]);
    await seedIssue("open", [tracked]);
    await signInAsAdmin();
    const res = await triage.setSiteFeedbackDispositionAction({
      ids: [free, drafted, tracked],
      disposition: "duplicate",
    });
    expect(res).toEqual({ updated: 1 });
    const status = new Map(
      (await getDb().select().from(schema.siteFeedback)).map((r) => [
        r.id,
        r.status,
      ]),
    );
    expect(status.get(free)).toBe("duplicate");
    expect(status.get(drafted)).toBe("open");
    expect(status.get(tracked)).toBe("open");
  });

  it("a disposition stamps status_changed_at", async () => {
    const owner = await seedUser("o@example.com");
    const id = await seedFeedback(owner);
    await signInAsAdmin();
    const before = Temporal.Now.instant();
    await triage.setSiteFeedbackDispositionAction({
      ids: [id],
      disposition: "wont_fix",
    });
    const [row] = await getDb().select().from(schema.siteFeedback);
    expect(row.statusChangedAt).not.toBeNull();
    expect(
      Temporal.Instant.compare(row.statusChangedAt!, before),
    ).toBeGreaterThanOrEqual(0);
  });

  it("a disposition skipped for a linked report leaves status_changed_at null", async () => {
    const owner = await seedUser("o@example.com");
    const tracked = await seedFeedback(owner);
    await seedIssue("open", [tracked]);
    await signInAsAdmin();
    await triage.setSiteFeedbackDispositionAction({
      ids: [tracked],
      disposition: "duplicate",
    });
    const [row] = await getDb().select().from(schema.siteFeedback);
    expect(row.statusChangedAt).toBeNull();
  });
});

// ── drafts and links ──────────────────────────────────────────────────

describe("drafts", () => {
  it("creates a draft titled from the earliest submission and links all", async () => {
    const owner = await seedUser("o@example.com");
    const later = await seedFeedback(owner, { title: "Later" });
    const earliest = await seedFeedback(owner, {
      title: "Earliest",
      kind: "feature",
      createdAt: Temporal.Instant.fromEpochMilliseconds(1000),
    });
    await signInAsAdmin();
    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [later, earliest],
    });
    const detail = await triage.getSiteFeedbackIssueAction({ id });
    expect(detail.title).toBe("Earliest");
    expect(detail.state).toBe("draft");
    expect(detail.labels).toEqual(["bug", "enhancement", "feedback"]);
    expect(detail.reportCount).toBe(2);
    expect(detail.unpostedCount).toBe(2);
    expect(detail.githubConfigured).toBe(false);
    expect(detail.githubRepo).toBeNull();
    expect(detail.links.map((l) => l.feedbackId)).toEqual([earliest, later]);
    expect(detail.links[0]?.quotedMd).toContain("Earliest");
  });

  it("creates a draft over 150 submissions", async () => {
    const owner = await seedUser("o@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      ids.push(await seedFeedback(owner));
    }
    await signInAsAdmin();
    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: ids,
    });
    expect((await triage.getSiteFeedbackIssueAction({ id })).reportCount).toBe(
      150,
    );
  });

  it("returns conflict for a stale token and leaves the title alone", async () => {
    const owner = await seedUser("o@example.com");
    const f = await seedFeedback(owner);
    await signInAsAdmin();
    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [f],
    });
    const before = await triage.getSiteFeedbackIssueAction({ id });
    const ok = await triage.updateSiteFeedbackIssueDraftAction({
      id,
      title: "Edited",
      summaryMd: "sum",
      labels: ["bug"],
      expectedUpdatedAtMs: before.updatedAt.epochMilliseconds,
    });
    expect(ok.ok).toBe(true);
    const stale = await triage.updateSiteFeedbackIssueDraftAction({
      id,
      title: "Stale",
      summaryMd: "x",
      labels: [],
      expectedUpdatedAtMs: before.updatedAt.epochMilliseconds,
    });
    expect(stale).toEqual({ ok: false, reason: "conflict" });
    const after = await triage.getSiteFeedbackIssueAction({ id });
    expect(after.title).toBe("Edited");
    expect(after.summaryMd).toBe("sum");
    expect(after.labels).toEqual(["bug"]);
    expect(ok).toEqual({
      ok: true,
      updatedAtMs: after.updatedAt.epochMilliseconds,
    });
  });

  it("refuses to edit a filed issue and deletes only drafts", async () => {
    const owner = await seedUser("o@example.com");
    const f = await seedFeedback(owner);
    const open = await seedIssue("open", [f]);
    await signInAsAdmin();
    expect(
      await triage.updateSiteFeedbackIssueDraftAction({
        id: open,
        title: "t",
        summaryMd: "s",
        labels: [],
        expectedUpdatedAtMs: 0,
      }),
    ).toEqual({ ok: false, reason: "not_draft" });
    await expect(
      triage.deleteSiteFeedbackIssueDraftAction({ id: open }),
    ).rejects.toThrow();

    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [f],
    });
    expect(await triage.deleteSiteFeedbackIssueDraftAction({ id })).toEqual({
      ok: true,
    });
    const links = await getDb()
      .select()
      .from(schema.siteFeedbackIssueLinks)
      .where(eq(schema.siteFeedbackIssueLinks.issueId, id));
    expect(links).toEqual([]);
  });

  it("links idempotently, and refuses to unlink or edit a posted link", async () => {
    const owner = await seedUser("o@example.com");
    const a = await seedFeedback(owner);
    const b = await seedFeedback(owner);
    await signInAsAdmin();
    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [a],
    });
    expect(
      await triage.linkSiteFeedbackAction({ issueId: id, feedbackIds: [b] }),
    ).toEqual({ added: 1 });
    expect(
      await triage.linkSiteFeedbackAction({ issueId: id, feedbackIds: [b] }),
    ).toEqual({ added: 0 });
    expect(
      await triage.updateSiteFeedbackQuoteAction({
        issueId: id,
        feedbackId: b,
        quotedMd: "edited",
      }),
    ).toEqual({ ok: true });
    expect(
      (await triage.getSiteFeedbackIssueAction({ id })).links.find(
        (l) => l.feedbackId === b,
      )?.quotedMd,
    ).toBe("edited");
    expect(
      await triage.unlinkSiteFeedbackAction({ issueId: id, feedbackId: b }),
    ).toEqual({ ok: true });

    const posted = await seedFeedback(owner);
    const open = await seedIssue("open", [posted], {}, true);
    await expect(
      triage.unlinkSiteFeedbackAction({ issueId: open, feedbackId: posted }),
    ).rejects.toThrow("Already posted to GitHub");
    await expect(
      triage.updateSiteFeedbackQuoteAction({
        issueId: open,
        feedbackId: posted,
        quotedMd: "x",
      }),
    ).rejects.toThrow("Already posted to GitHub");
  });
});

// ── related ───────────────────────────────────────────────────────────

describe("listRelatedSiteFeedbackAction", () => {
  it("suggests by shared words and by page path, excluding linked and disposed", async () => {
    const owner = await seedUser("o@example.com");
    const linked = await seedFeedback(owner, {
      title: "Calendar blank",
      pageUrl: "https://ucmc.example/calendar",
    });
    const spinner = await seedFeedback(owner, {
      title: "Calendar spinner forever",
    });
    const alsoLinked = await seedFeedback(owner, {
      title: "Calendar empty page",
    });
    const disposed = await seedFeedback(owner, {
      title: "Calendar crash",
      status: "wont_fix",
    });
    const samePath = await seedFeedback(owner, {
      title: "Zzz",
      body: "Qqq",
      pageUrl: "https://other.example/calendar",
    });
    const unrelated = await seedFeedback(owner, {
      title: "Zzz",
      body: "Qqq",
      pageUrl: "https://ucmc.example/gear",
    });
    await signInAsAdmin();
    const { id } = await triage.createSiteFeedbackIssueDraftAction({
      feedbackIds: [linked, alsoLinked],
    });
    const related = await triage.listRelatedSiteFeedbackAction({ issueId: id });
    const ids = related.map((r) => r.id);
    expect(ids).toContain(spinner);
    expect(ids).toContain(samePath);
    expect(ids).not.toContain(linked);
    expect(ids).not.toContain(alsoLinked);
    expect(ids).not.toContain(disposed);
    expect(ids).not.toContain(unrelated);
    expect(ids.indexOf(spinner)).toBeLessThan(ids.indexOf(samePath));
  });
});

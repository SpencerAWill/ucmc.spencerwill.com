/**
 * Pure data access for site-feedback triage: derived submission state,
 * issue drafts and links. No auth and no business logic; the actions layer
 * authorizes and decides.
 *
 * The derived state is written against the literal table names
 * (`"feedback"`, `"site_feedback_issues"`) rather than Drizzle column
 * references, because Drizzle drops the table qualifier in a single-table
 * select and a correlated subquery needs it.
 */
import { and, asc, count, desc, eq, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type {
  SiteFeedbackDisposition,
  SiteFeedbackIssueState,
  SiteFeedbackKind,
  SiteFeedbackState,
  SiteFeedbackTriageView,
} from "#/features/site-feedback/server/limits";
import {
  getDb,
  inJsonArray,
  insertStatements,
  runBatch,
  schema,
} from "#/server/db";
import { SITE_FEEDBACK_SEARCH, searchMatches } from "#/server/db/search";

// ── derived state ───────────────────────────────────────────────────────

const LINKED_ISSUE = (condition: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM "site_feedback_issue_links" AS l JOIN "site_feedback_issues" AS i ON i."id" = l."issue_id" WHERE l."feedback_id" = "feedback"."id" AND ${condition})`;

/**
 * The submission's state, derived on read (design: Derived submission
 * state). Linked to a filed issue: all closed is `resolved`, otherwise
 * `tracked`. Linked only to drafts: `in_draft`. Unlinked: its own
 * disposition, with legacy `acknowledged` read as `new` and legacy
 * `closed` as `wont_fix`.
 */
export function siteFeedbackStateSql(): SQL<SiteFeedbackState> {
  return sql<SiteFeedbackState>`(CASE
    WHEN ${LINKED_ISSUE(sql`i."state" <> 'draft'`)} THEN
      CASE WHEN ${LINKED_ISSUE(sql`i."state" NOT IN ('draft', 'closed')`)}
        THEN 'tracked' ELSE 'resolved' END
    WHEN ${LINKED_ISSUE(sql`i."state" = 'draft'`)} THEN 'in_draft'
    WHEN "feedback"."status" IN ('open', 'acknowledged') THEN 'new'
    WHEN "feedback"."status" IN ('closed', 'wont_fix') THEN 'wont_fix'
    ELSE "feedback"."status"
  END)`;
}

const VIEW_STATES: Record<
  SiteFeedbackTriageView,
  readonly SiteFeedbackState[]
> = {
  new: ["new"],
  in_draft: ["in_draft"],
  tracked: ["tracked"],
  closed: ["resolved", "wont_fix", "duplicate"],
};

/** `GROUP BY`-free count of every state, for the triage tabs. */
export async function countFeedbackByState(): Promise<
  Record<SiteFeedbackState, number>
> {
  const state = siteFeedbackStateSql();
  const rows = await getDb()
    .select({ state, n: count() })
    .from(schema.siteFeedback)
    .groupBy(state);
  const out: Record<SiteFeedbackState, number> = {
    new: 0,
    in_draft: 0,
    tracked: 0,
    resolved: 0,
    wont_fix: 0,
    duplicate: 0,
  };
  for (const row of rows) {
    out[row.state] = row.n;
  }
  return out;
}

/** One member's submissions in `states`. */
export async function countMyFeedbackInStates(
  userId: string,
  states: readonly SiteFeedbackState[],
): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.siteFeedback)
    .where(
      and(
        eq(schema.siteFeedback.createdBy, userId),
        inJsonArray(siteFeedbackStateSql(), states),
      ),
    );
  return row.n;
}

/** Every member's submissions in `states`. */
export async function countFeedbackInStates(
  states: readonly SiteFeedbackState[],
): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.siteFeedback)
    .where(inJsonArray(siteFeedbackStateSql(), states));
  return row.n;
}

// ── triage rows ─────────────────────────────────────────────────────────

export interface TriageFeedbackRow {
  id: string;
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
  createdAt: Temporal.Instant;
  createdByPublicId: string | null;
  state: SiteFeedbackState;
}

const triageSelect = {
  id: schema.siteFeedback.id,
  kind: schema.siteFeedback.kind,
  title: schema.siteFeedback.title,
  body: schema.siteFeedback.body,
  pageUrl: schema.siteFeedback.pageUrl,
  userAgent: schema.siteFeedback.userAgent,
  createdAt: schema.siteFeedback.createdAt,
  createdByPublicId: schema.users.publicId,
  state: siteFeedbackStateSql(),
};

export async function listTriageFeedback(
  view: SiteFeedbackTriageView,
  q: string | undefined,
): Promise<TriageFeedbackRow[]> {
  const search = q?.trim();
  return getDb()
    .select(triageSelect)
    .from(schema.siteFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteFeedback.createdBy))
    .where(
      and(
        inJsonArray(siteFeedbackStateSql(), VIEW_STATES[view]),
        search
          ? searchMatches(
              schema.siteFeedback.id,
              SITE_FEEDBACK_SEARCH,
              "feedback_id",
              search,
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.siteFeedback.createdAt));
}

/** Submissions by id, with the author's public id, oldest first. */
export async function getTriageFeedbackByIds(
  ids: readonly string[],
): Promise<TriageFeedbackRow[]> {
  return getDb()
    .select(triageSelect)
    .from(schema.siteFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteFeedback.createdBy))
    .where(inJsonArray(schema.siteFeedback.id, ids))
    .orderBy(asc(schema.siteFeedback.createdAt), asc(schema.siteFeedback.id));
}

export interface LinkedIssueRow {
  feedbackId: string;
  issueId: string;
  title: string;
  githubNumber: number | null;
  githubUrl: string | null;
  state: SiteFeedbackIssueState;
}

/** The issues each of `feedbackIds` is linked to (drafts included). */
export async function listIssuesForFeedback(
  feedbackIds: readonly string[],
): Promise<LinkedIssueRow[]> {
  if (feedbackIds.length === 0) {
    return [];
  }
  return getDb()
    .select({
      feedbackId: schema.siteFeedbackIssueLinks.feedbackId,
      issueId: schema.siteFeedbackIssues.id,
      title: schema.siteFeedbackIssues.title,
      githubNumber: schema.siteFeedbackIssues.githubNumber,
      githubUrl: schema.siteFeedbackIssues.githubUrl,
      state: schema.siteFeedbackIssues.state,
    })
    .from(schema.siteFeedbackIssueLinks)
    .innerJoin(
      schema.siteFeedbackIssues,
      eq(schema.siteFeedbackIssues.id, schema.siteFeedbackIssueLinks.issueId),
    )
    .where(inJsonArray(schema.siteFeedbackIssueLinks.feedbackId, feedbackIds))
    .orderBy(
      asc(schema.siteFeedbackIssues.createdAt),
      asc(schema.siteFeedbackIssues.id),
    );
}

// ── issue summaries ─────────────────────────────────────────────────────

export interface IssueSummaryRow {
  id: string;
  state: SiteFeedbackIssueState;
  title: string;
  githubNumber: number | null;
  githubUrl: string | null;
  reportCount: number;
  unpostedCount: number;
  updatedAt: Temporal.Instant;
}

const issueSummarySelect = {
  id: schema.siteFeedbackIssues.id,
  state: schema.siteFeedbackIssues.state,
  title: schema.siteFeedbackIssues.title,
  githubNumber: schema.siteFeedbackIssues.githubNumber,
  githubUrl: schema.siteFeedbackIssues.githubUrl,
  reportCount: sql<number>`(SELECT count(*) FROM "site_feedback_issue_links" AS l WHERE l."issue_id" = "site_feedback_issues"."id")`,
  unpostedCount: sql<number>`(SELECT count(*) FROM "site_feedback_issue_links" AS l WHERE l."issue_id" = "site_feedback_issues"."id" AND l."posted_at" IS NULL)`,
  updatedAt: schema.siteFeedbackIssues.updatedAt,
};

export async function listDraftIssueSummaries(): Promise<IssueSummaryRow[]> {
  return getDb()
    .select(issueSummarySelect)
    .from(schema.siteFeedbackIssues)
    .where(eq(schema.siteFeedbackIssues.state, "draft"))
    .orderBy(desc(schema.siteFeedbackIssues.updatedAt));
}

/** Filed issues still open on GitHub (including one mid-filing). */
export async function listOpenIssueSummaries(): Promise<IssueSummaryRow[]> {
  return getDb()
    .select(issueSummarySelect)
    .from(schema.siteFeedbackIssues)
    .where(
      and(
        ne(schema.siteFeedbackIssues.state, "draft"),
        ne(schema.siteFeedbackIssues.state, "closed"),
      ),
    )
    .orderBy(desc(schema.siteFeedbackIssues.updatedAt));
}

/** When the last GitHub sync touched any issue, or null if never. */
export async function getLastSyncedAt(): Promise<Temporal.Instant | null> {
  const [row] = await getDb()
    .select({ ms: sql<number | null>`max("github_synced_at")` })
    .from(schema.siteFeedbackIssues);
  return row.ms === null
    ? null
    : Temporal.Instant.fromEpochMilliseconds(row.ms);
}

export async function getIssueSummary(
  id: string,
): Promise<IssueSummaryRow | null> {
  const rows = await getDb()
    .select(issueSummarySelect)
    .from(schema.siteFeedbackIssues)
    .where(eq(schema.siteFeedbackIssues.id, id));
  return rows.at(0) ?? null;
}

export interface IssueRow {
  id: string;
  state: SiteFeedbackIssueState;
  title: string;
  summaryMd: string | null;
  labels: string[];
  updatedAt: Temporal.Instant;
}

export async function getIssue(id: string): Promise<IssueRow | null> {
  const rows = await getDb()
    .select({
      id: schema.siteFeedbackIssues.id,
      state: schema.siteFeedbackIssues.state,
      title: schema.siteFeedbackIssues.title,
      summaryMd: schema.siteFeedbackIssues.summaryMd,
      labels: schema.siteFeedbackIssues.labels,
      updatedAt: schema.siteFeedbackIssues.updatedAt,
    })
    .from(schema.siteFeedbackIssues)
    .where(eq(schema.siteFeedbackIssues.id, id));
  return rows.at(0) ?? null;
}

export interface IssueLinkRow {
  feedbackId: string;
  kind: SiteFeedbackKind;
  title: string;
  pageUrl: string | null;
  quotedMd: string;
  postedAt: Temporal.Instant | null;
}

export async function listIssueLinks(issueId: string): Promise<IssueLinkRow[]> {
  return getDb()
    .select({
      feedbackId: schema.siteFeedbackIssueLinks.feedbackId,
      kind: schema.siteFeedback.kind,
      title: schema.siteFeedback.title,
      pageUrl: schema.siteFeedback.pageUrl,
      quotedMd: schema.siteFeedbackIssueLinks.quotedMd,
      postedAt: schema.siteFeedbackIssueLinks.postedAt,
    })
    .from(schema.siteFeedbackIssueLinks)
    .innerJoin(
      schema.siteFeedback,
      eq(schema.siteFeedback.id, schema.siteFeedbackIssueLinks.feedbackId),
    )
    .where(eq(schema.siteFeedbackIssueLinks.issueId, issueId))
    .orderBy(asc(schema.siteFeedback.createdAt), asc(schema.siteFeedback.id));
}

// ── writes ──────────────────────────────────────────────────────────────

/** Set the disposition of every id; returns how many rows changed. */
export async function setDisposition(
  ids: readonly string[],
  disposition: SiteFeedbackDisposition,
): Promise<number> {
  const rows = await getDb()
    .update(schema.siteFeedback)
    .set({ status: disposition, updatedAt: Temporal.Now.instant() })
    .where(inJsonArray(schema.siteFeedback.id, ids))
    .returning({ id: schema.siteFeedback.id });
  return rows.length;
}

export interface NewLink {
  feedbackId: string;
  quotedMd: string;
}

/** Insert a draft and its links in one atomic batch. */
export async function insertDraftWithLinks(input: {
  id: string;
  title: string;
  labels: string[];
  createdBy: string;
  links: readonly NewLink[];
}): Promise<void> {
  const now = Temporal.Now.instant();
  await runBatch([
    getDb().insert(schema.siteFeedbackIssues).values({
      id: input.id,
      state: "draft",
      title: input.title,
      labels: input.labels,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    }),
    ...insertStatements(
      schema.siteFeedbackIssueLinks,
      input.links.map((link) => ({
        issueId: input.id,
        feedbackId: link.feedbackId,
        quotedMd: link.quotedMd,
        addedBy: input.createdBy,
        addedAt: now,
      })),
    ),
  ]);
}

/**
 * Update a draft only if its `updated_at` is still `expectedUpdatedAtMs`.
 * Returns the new token, or null when no row matched.
 */
export async function updateDraftIfCurrent(input: {
  id: string;
  title: string;
  summaryMd: string;
  labels: string[];
  expectedUpdatedAtMs: number;
}): Promise<number | null> {
  // Always strictly later than the token it replaces, so a second editor
  // holding the old token cannot match even within the same millisecond.
  const nextMs = Math.max(Date.now(), input.expectedUpdatedAtMs + 1);
  const rows = await getDb()
    .update(schema.siteFeedbackIssues)
    .set({
      title: input.title,
      summaryMd: input.summaryMd,
      labels: input.labels,
      updatedAt: Temporal.Instant.fromEpochMilliseconds(nextMs),
    })
    .where(
      and(
        eq(schema.siteFeedbackIssues.id, input.id),
        eq(schema.siteFeedbackIssues.state, "draft"),
        eq(
          schema.siteFeedbackIssues.updatedAt,
          Temporal.Instant.fromEpochMilliseconds(input.expectedUpdatedAtMs),
        ),
      ),
    )
    .returning({ updatedAt: schema.siteFeedbackIssues.updatedAt });
  return rows.length === 0 ? null : nextMs;
}

/** Delete a draft (links cascade). Returns whether a draft was removed. */
export async function deleteDraft(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.siteFeedbackIssues)
    .where(
      and(
        eq(schema.siteFeedbackIssues.id, id),
        eq(schema.siteFeedbackIssues.state, "draft"),
      ),
    )
    .returning({ id: schema.siteFeedbackIssues.id });
  return rows.length > 0;
}

/** Which of `feedbackIds` are already linked to the issue. */
export async function listLinkedFeedbackIds(
  issueId: string,
  feedbackIds: readonly string[],
): Promise<string[]> {
  const rows = await getDb()
    .select({ feedbackId: schema.siteFeedbackIssueLinks.feedbackId })
    .from(schema.siteFeedbackIssueLinks)
    .where(
      and(
        eq(schema.siteFeedbackIssueLinks.issueId, issueId),
        inJsonArray(schema.siteFeedbackIssueLinks.feedbackId, feedbackIds),
      ),
    );
  return rows.map((r) => r.feedbackId);
}

export async function insertLinks(
  issueId: string,
  links: readonly NewLink[],
  addedBy: string,
): Promise<void> {
  const now = Temporal.Now.instant();
  await runBatch(
    insertStatements(
      schema.siteFeedbackIssueLinks,
      links.map((link) => ({
        issueId,
        feedbackId: link.feedbackId,
        quotedMd: link.quotedMd,
        addedBy,
        addedAt: now,
      })),
      { onConflictDoNothing: true },
    ),
  );
}

export async function getLink(
  issueId: string,
  feedbackId: string,
): Promise<{ postedAt: Temporal.Instant | null } | null> {
  const rows = await getDb()
    .select({ postedAt: schema.siteFeedbackIssueLinks.postedAt })
    .from(schema.siteFeedbackIssueLinks)
    .where(
      and(
        eq(schema.siteFeedbackIssueLinks.issueId, issueId),
        eq(schema.siteFeedbackIssueLinks.feedbackId, feedbackId),
      ),
    );
  return rows.at(0) ?? null;
}

/** Delete an unposted link; a posted one is left alone. */
export async function deleteUnpostedLink(
  issueId: string,
  feedbackId: string,
): Promise<void> {
  await getDb()
    .delete(schema.siteFeedbackIssueLinks)
    .where(
      and(
        eq(schema.siteFeedbackIssueLinks.issueId, issueId),
        eq(schema.siteFeedbackIssueLinks.feedbackId, feedbackId),
        sql`${schema.siteFeedbackIssueLinks.postedAt} IS NULL`,
      ),
    );
}

/** Rewrite an unposted link's quote; returns whether a row changed. */
export async function updateUnpostedQuote(
  issueId: string,
  feedbackId: string,
  quotedMd: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.siteFeedbackIssueLinks)
    .set({ quotedMd })
    .where(
      and(
        eq(schema.siteFeedbackIssueLinks.issueId, issueId),
        eq(schema.siteFeedbackIssueLinks.feedbackId, feedbackId),
        sql`${schema.siteFeedbackIssueLinks.postedAt} IS NULL`,
      ),
    )
    .returning({ feedbackId: schema.siteFeedbackIssueLinks.feedbackId });
  return rows.length > 0;
}

// ── related ─────────────────────────────────────────────────────────────

/** Ids of submissions matching the FTS5 `match` string, best first. */
export async function rankedFtsMatches(
  match: string,
  limit: number,
): Promise<string[]> {
  const rows = await getDb().all<{ feedback_id: string }>(
    sql`SELECT k."feedback_id" AS feedback_id
      FROM "site_feedback_fts" AS f
      JOIN "site_feedback_fts_keys" AS k ON k."id" = f."rowid"
      WHERE "site_feedback_fts" MATCH ${match}
      ORDER BY bm25("site_feedback_fts")
      LIMIT ${limit}`,
  );
  return rows.map((r) => r.feedback_id);
}

// `page_url` is stored as origin + pathname, so everything from the first
// `/` after the `//` is the pathname.
const AFTER_SCHEME = sql`substr("feedback"."page_url", instr("feedback"."page_url", '//') + 2)`;
const PATHNAME = sql`substr(${AFTER_SCHEME}, instr(${AFTER_SCHEME}, '/'))`;

/**
 * Unlinked, still-`new` submissions that are either in `matchedIds` or sit
 * on one of `pathnames`. Capped; the caller orders and trims.
 */
export async function listRelatedCandidates(input: {
  issueId: string;
  matchedIds: readonly string[];
  pathnames: readonly string[];
}): Promise<TriageFeedbackRow[]> {
  const byMatch =
    input.matchedIds.length > 0
      ? inJsonArray(schema.siteFeedback.id, input.matchedIds)
      : undefined;
  const byPath =
    input.pathnames.length > 0
      ? and(
          sql`"feedback"."page_url" IS NOT NULL`,
          inJsonArray(PATHNAME, input.pathnames),
        )
      : undefined;
  const reach = or(byMatch, byPath);
  if (reach === undefined) {
    return [];
  }
  return getDb()
    .select(triageSelect)
    .from(schema.siteFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteFeedback.createdBy))
    .where(
      and(
        inJsonArray(siteFeedbackStateSql(), ["new"]),
        sql`NOT EXISTS (SELECT 1 FROM "site_feedback_issue_links" AS l WHERE l."feedback_id" = "feedback"."id" AND l."issue_id" = ${input.issueId})`,
        reach,
      ),
    )
    .orderBy(desc(schema.siteFeedback.createdAt))
    .limit(200);
}

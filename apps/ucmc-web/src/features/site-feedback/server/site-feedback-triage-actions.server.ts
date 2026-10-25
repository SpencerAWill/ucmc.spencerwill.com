/**
 * Triage actions for site feedback: the list, dispositions, issue drafts,
 * links and related suggestions. Every action requires
 * `site_feedback:manage`. The shell in `./site-feedback-triage-fns.ts`
 * dynamic-imports this module so server-only code stays off the client.
 */
import { uuidv7 } from "uuidv7";

import { getGithubConfig } from "#/features/site-feedback/server/github.server";
import {
  defaultLabelsFor,
  quotedReportFor,
} from "#/features/site-feedback/server/issue-format";
import type {
  SiteFeedbackDispositionInput,
  SiteFeedbackIssueDraftCreateInput,
  SiteFeedbackIssueDraftUpdateInput,
  SiteFeedbackIssueIdInput,
  SiteFeedbackIssueState,
  SiteFeedbackKind,
  SiteFeedbackLinkInput,
  SiteFeedbackQuoteUpdateInput,
  SiteFeedbackRelatedInput,
  SiteFeedbackState,
  SiteFeedbackTriageListInput,
  SiteFeedbackTriageView,
  SiteFeedbackUnlinkInput,
} from "#/features/site-feedback/server/limits";
import { requireSiteFeedbackManager } from "#/features/site-feedback/server/site-feedback-actions.server";
import {
  countFeedbackByState,
  deleteDraft,
  deleteUnpostedLink,
  getIssue,
  getIssueSummary,
  getLastSyncedAt,
  getLink,
  getTriageFeedbackByIds,
  insertDraftWithLinks,
  insertLinks,
  listDraftIssueSummaries,
  listIssueLinks,
  listIssuesForFeedback,
  listLinkedFeedbackIds,
  listOpenIssueSummaries,
  listRelatedCandidates,
  listTriageFeedback,
  rankedFtsMatches,
  setDisposition,
  updateDraftIfCurrent,
  updateUnpostedQuote,
} from "#/features/site-feedback/server/triage-repo.server";
import type {
  IssueSummaryRow,
  TriageFeedbackRow,
} from "#/features/site-feedback/server/triage-repo.server";

// ── public types ────────────────────────────────────────────────────────

export interface SiteFeedbackTriageRow {
  id: string;
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
  createdAt: Temporal.Instant;
  createdByPublicId: string | null;
  state: SiteFeedbackState;
  issues: {
    id: string;
    title: string;
    githubNumber: number | null;
    state: SiteFeedbackIssueState;
  }[];
}

export interface SiteFeedbackIssueSummary {
  id: string;
  state: SiteFeedbackIssueState;
  title: string;
  githubNumber: number | null;
  githubUrl: string | null;
  reportCount: number;
  unpostedCount: number;
  updatedAt: Temporal.Instant;
}

export interface SiteFeedbackTriage {
  rows: SiteFeedbackTriageRow[];
  drafts: SiteFeedbackIssueSummary[];
  openIssues: SiteFeedbackIssueSummary[];
  counts: Record<SiteFeedbackTriageView, number>;
  githubConfigured: boolean;
  lastSyncedAt: Temporal.Instant | null;
}

export type SiteFeedbackIssueDetail = SiteFeedbackIssueSummary & {
  summaryMd: string | null;
  labels: string[];
  githubConfigured: boolean;
  links: {
    feedbackId: string;
    kind: SiteFeedbackKind;
    title: string;
    quotedMd: string;
    postedAt: Temporal.Instant | null;
  }[];
};

// ── helpers ─────────────────────────────────────────────────────────────

const ALREADY_POSTED = "Already posted to GitHub";

const RELATED_MAX_TERMS = 12;
const RELATED_MIN_TERM_LENGTH = 4;
const RELATED_LIMIT = 10;
const RELATED_FTS_FETCH = 50;

async function withIssues(
  rows: readonly TriageFeedbackRow[],
): Promise<SiteFeedbackTriageRow[]> {
  const links = await listIssuesForFeedback(rows.map((r) => r.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    pageUrl: row.pageUrl,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    createdByPublicId: row.createdByPublicId,
    state: row.state,
    issues: links
      .filter((l) => l.feedbackId === row.id)
      .map((l) => ({
        id: l.issueId,
        title: l.title,
        githubNumber: l.githubNumber,
        state: l.state,
      })),
  }));
}

function toIssueSummary(row: IssueSummaryRow): SiteFeedbackIssueSummary {
  return {
    id: row.id,
    state: row.state,
    title: row.title,
    githubNumber: row.githubNumber,
    githubUrl: row.githubUrl,
    reportCount: row.reportCount,
    unpostedCount: row.unpostedCount,
    updatedAt: row.updatedAt,
  };
}

function quotedFor(row: TriageFeedbackRow): string {
  return quotedReportFor({
    kind: row.kind,
    title: row.title,
    body: row.body,
    pageUrl: row.pageUrl,
    userAgent: row.userAgent,
    createdByPublicId: row.createdByPublicId,
    createdAt: row.createdAt,
  });
}

/** Every requested id must exist; the order is the repo's (oldest first). */
async function loadSubmissions(
  feedbackIds: readonly string[],
): Promise<TriageFeedbackRow[]> {
  const ids = [...new Set(feedbackIds)];
  const rows = await getTriageFeedbackByIds(ids);
  if (rows.length !== ids.length) {
    throw new Error("Some submissions no longer exist");
  }
  return rows;
}

function relatedTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (word.length >= RELATED_MIN_TERM_LENGTH) {
      terms.add(word);
    }
    if (terms.size === RELATED_MAX_TERMS) {
      break;
    }
  }
  return [...terms];
}

function pathnameOf(pageUrl: string | null): string | null {
  if (pageUrl === null) {
    return null;
  }
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return null;
  }
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listSiteFeedbackTriageAction(
  input: SiteFeedbackTriageListInput,
): Promise<SiteFeedbackTriage> {
  await requireSiteFeedbackManager();
  const [rows, drafts, openIssues, byState, lastSyncedAt] = await Promise.all([
    listTriageFeedback(input.view, input.q),
    listDraftIssueSummaries(),
    listOpenIssueSummaries(),
    countFeedbackByState(),
    getLastSyncedAt(),
  ]);
  return {
    rows: await withIssues(rows),
    drafts: drafts.map(toIssueSummary),
    openIssues: openIssues.map(toIssueSummary),
    counts: {
      new: byState.new,
      in_draft: byState.in_draft,
      tracked: byState.tracked,
      closed: byState.resolved + byState.wont_fix + byState.duplicate,
    },
    githubConfigured: getGithubConfig() !== null,
    lastSyncedAt,
  };
}

export async function setSiteFeedbackDispositionAction(
  input: SiteFeedbackDispositionInput,
): Promise<{ updated: number }> {
  await requireSiteFeedbackManager();
  return { updated: await setDisposition(input.ids, input.disposition) };
}

export async function createSiteFeedbackIssueDraftAction(
  input: SiteFeedbackIssueDraftCreateInput,
): Promise<{ id: string }> {
  const principal = await requireSiteFeedbackManager();
  const rows = await loadSubmissions(input.feedbackIds);
  const id = `sfi_${uuidv7()}`;
  await insertDraftWithLinks({
    id,
    title: rows[0].title,
    labels: defaultLabelsFor(rows.map((r) => r.kind)),
    createdBy: principal.userId,
    links: rows.map((row) => ({
      feedbackId: row.id,
      quotedMd: quotedFor(row),
    })),
  });
  return { id };
}

export async function getSiteFeedbackIssueAction(
  input: SiteFeedbackIssueIdInput,
): Promise<SiteFeedbackIssueDetail> {
  await requireSiteFeedbackManager();
  const [summary, issue, links] = await Promise.all([
    getIssueSummary(input.id),
    getIssue(input.id),
    listIssueLinks(input.id),
  ]);
  if (!summary || !issue) {
    throw new Error("Issue not found");
  }
  return {
    ...toIssueSummary(summary),
    summaryMd: issue.summaryMd,
    labels: issue.labels,
    githubConfigured: getGithubConfig() !== null,
    links: links.map((l) => ({
      feedbackId: l.feedbackId,
      kind: l.kind,
      title: l.title,
      quotedMd: l.quotedMd,
      postedAt: l.postedAt,
    })),
  };
}

export async function updateSiteFeedbackIssueDraftAction(
  input: SiteFeedbackIssueDraftUpdateInput,
): Promise<
  | { ok: true; updatedAtMs: number }
  | { ok: false; reason: "conflict" | "not_draft" }
> {
  await requireSiteFeedbackManager();
  const updatedAtMs = await updateDraftIfCurrent(input);
  if (updatedAtMs !== null) {
    return { ok: true, updatedAtMs };
  }
  // The conditional UPDATE matched nothing; say why.
  const issue = await getIssue(input.id);
  return {
    ok: false,
    reason: issue?.state === "draft" ? "conflict" : "not_draft",
  };
}

export async function deleteSiteFeedbackIssueDraftAction(
  input: SiteFeedbackIssueIdInput,
): Promise<{ ok: true }> {
  await requireSiteFeedbackManager();
  const deleted = await deleteDraft(input.id);
  if (!deleted && (await getIssue(input.id)) !== null) {
    throw new Error("Only drafts can be deleted");
  }
  return { ok: true };
}

export async function linkSiteFeedbackAction(
  input: SiteFeedbackLinkInput,
): Promise<{ added: number }> {
  const principal = await requireSiteFeedbackManager();
  if ((await getIssue(input.issueId)) === null) {
    throw new Error("Issue not found");
  }
  const ids = [...new Set(input.feedbackIds)];
  const existing = new Set(await listLinkedFeedbackIds(input.issueId, ids));
  const fresh = ids.filter((id) => !existing.has(id));
  if (fresh.length === 0) {
    return { added: 0 };
  }
  const rows = await loadSubmissions(fresh);
  await insertLinks(
    input.issueId,
    rows.map((row) => ({ feedbackId: row.id, quotedMd: quotedFor(row) })),
    principal.userId,
  );
  return { added: rows.length };
}

export async function unlinkSiteFeedbackAction(
  input: SiteFeedbackUnlinkInput,
): Promise<{ ok: true }> {
  await requireSiteFeedbackManager();
  const link = await getLink(input.issueId, input.feedbackId);
  if (link?.postedAt) {
    throw new Error(ALREADY_POSTED);
  }
  await deleteUnpostedLink(input.issueId, input.feedbackId);
  return { ok: true };
}

export async function updateSiteFeedbackQuoteAction(
  input: SiteFeedbackQuoteUpdateInput,
): Promise<{ ok: true }> {
  await requireSiteFeedbackManager();
  const link = await getLink(input.issueId, input.feedbackId);
  if (!link) {
    throw new Error("Submission is not linked to this issue");
  }
  if (link.postedAt) {
    throw new Error(ALREADY_POSTED);
  }
  await updateUnpostedQuote(input.issueId, input.feedbackId, input.quotedMd);
  return { ok: true };
}

export async function listRelatedSiteFeedbackAction(
  input: SiteFeedbackRelatedInput,
): Promise<SiteFeedbackTriageRow[]> {
  await requireSiteFeedbackManager();
  const issue = await getIssue(input.issueId);
  if (!issue) {
    throw new Error("Issue not found");
  }
  const links = await listIssueLinks(input.issueId);
  const terms = relatedTerms(`${issue.title} ${issue.summaryMd ?? ""}`);
  const pathnames = [
    ...new Set(
      links
        .map((l) => pathnameOf(l.pageUrl))
        .filter((p): p is string => p !== null),
    ),
  ];
  if (terms.length === 0 && pathnames.length === 0) {
    return [];
  }

  // The trigram tokenizer makes each quoted term a substring match.
  const matchedIds =
    terms.length === 0
      ? []
      : await rankedFtsMatches(
          terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR "),
          RELATED_FTS_FETCH,
        );
  const candidates = await listRelatedCandidates({
    issueId: input.issueId,
    matchedIds,
    pathnames,
  });

  // Text matches first, in bm25 order; same-path-only submissions after.
  const rank = new Map(matchedIds.map((id, i) => [id, i]));
  const ordered = [...candidates].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (rank.get(b.id) ?? Number.POSITIVE_INFINITY),
  );
  return withIssues(ordered.slice(0, RELATED_LIMIT));
}

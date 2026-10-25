/**
 * Triage actions for site feedback: the list, dispositions, issue drafts,
 * links and related suggestions. Every action requires
 * `site_feedback:manage`. The shell in `./site-feedback-triage-fns.ts`
 * dynamic-imports this module so server-only code stays off the client.
 */
import { uuidv7 } from "uuidv7";

import {
  GithubError,
  createComment,
  createIssue,
  findIssueByMarker,
  getGithubConfig,
  getIssue as getGithubIssue,
} from "#/features/site-feedback/server/github.server";
import type { GithubConfig } from "#/features/site-feedback/server/github.server";
import {
  GITHUB_BODY_LIMIT,
  composeIssueBody,
  composeReportsComment,
  defaultLabelsFor,
  issueMarker,
  quotedReportFor,
} from "#/features/site-feedback/server/issue-format";
import type {
  SiteFeedbackAttachInput,
  SiteFeedbackDispositionInput,
  SiteFeedbackIssueDraftCreateInput,
  SiteFeedbackIssueDraftUpdateInput,
  SiteFeedbackIssueIdInput,
  SiteFeedbackIssueState,
  SiteFeedbackKind,
  SiteFeedbackLinkInput,
  SiteFeedbackPostPendingInput,
  SiteFeedbackQuoteUpdateInput,
  SiteFeedbackRelatedInput,
  SiteFeedbackState,
  SiteFeedbackTriageListInput,
  SiteFeedbackTriageView,
  SiteFeedbackUnlinkInput,
} from "#/features/site-feedback/server/limits";
import { requireSiteFeedbackManager } from "#/features/site-feedback/server/site-feedback-actions.server";
import {
  claimIssueForFiling,
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
  markIssueFiled,
  markLinksPosted,
  rankedFtsMatches,
  releaseFilingClaim,
  setDisposition,
  updateDraftIfCurrent,
  updateUnpostedQuote,
  upsertAttachedIssue,
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
  /** Non-secret `owner/name`; null when GitHub is unconfigured. */
  githubRepo: string | null;
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
    githubRepo: getGithubConfig()?.repo ?? null,
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

// ── GitHub: file, attach, post ──────────────────────────────────────────

export type GithubActionResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      reason:
        | "not_configured"
        | "already_filing"
        | "too_long"
        | "no_reports"
        | "not_found"
        | "pull_request"
        | "github_error";
      message: string;
    };

type GithubFailure = Extract<GithubActionResult<object>, { ok: false }>;

const FILING_STALE_MS = 5 * 60 * 1000;

const NOT_CONFIGURED: GithubFailure = {
  ok: false,
  reason: "not_configured",
  message: "GitHub isn't configured for this site.",
};

function githubError(err: GithubError, what: string): GithubFailure {
  return {
    ok: false,
    reason: "github_error",
    message: `GitHub refused the ${what} (${err.status}). Nothing was ${what === "comment" ? "posted" : "filed"}.`,
  };
}

export async function fileSiteFeedbackIssueAction(
  input: SiteFeedbackIssueIdInput,
): Promise<GithubActionResult<{ number: number; url: string }>> {
  const principal = await requireSiteFeedbackManager();
  const cfg = getGithubConfig();
  if (cfg === null) {
    return NOT_CONFIGURED;
  }
  const issue = await getIssue(input.id);
  if (issue === null) {
    return { ok: false, reason: "not_found", message: "Issue not found" };
  }
  if (issue.state !== "draft" && issue.state !== "filing") {
    return {
      ok: false,
      reason: "already_filing",
      message: "This issue has already been filed",
    };
  }
  const links = await listIssueLinks(input.id);
  if (links.length === 0) {
    return {
      ok: false,
      reason: "no_reports",
      message: "Add at least one report before filing",
    };
  }
  const body = composeIssueBody({
    issueId: issue.id,
    summaryMd: issue.summaryMd ?? "",
    reports: links.map((l) => l.quotedMd),
  });
  if (body.length > GITHUB_BODY_LIMIT) {
    return {
      ok: false,
      reason: "too_long",
      message: `Too long for one GitHub issue: unlink reports or trim their text (${body.length.toLocaleString("en-US")} / ${GITHUB_BODY_LIMIT.toLocaleString("en-US")} characters)`,
    };
  }

  const now = Temporal.Now.instant();
  const claim = await claimIssueForFiling(
    input.id,
    now,
    now.subtract({ milliseconds: FILING_STALE_MS }),
  );
  if (claim === null) {
    return {
      ok: false,
      reason: "already_filing",
      message: "This issue is already being filed",
    };
  }

  try {
    // A stale claim may have reached GitHub before the worker died: adopt
    // that issue rather than filing a duplicate.
    const adopted =
      claim === "stale"
        ? await findIssueByMarker(cfg, issueMarker(issue.id))
        : null;
    const filed =
      adopted ??
      (await createIssue(cfg, {
        title: issue.title,
        body,
        labels: issue.labels,
      }));
    await markIssueFiled({
      id: issue.id,
      number: filed.number,
      url: filed.url,
      filedBy: principal.userId,
      now: Temporal.Now.instant(),
    });
    return { ok: true, number: filed.number, url: filed.url };
  } catch (err) {
    if (err instanceof GithubError) {
      await releaseFilingClaim(issue.id);
      return githubError(err, "issue");
    }
    throw err;
  }
}

async function postPending(
  cfg: GithubConfig,
  issueId: string,
  githubNumber: number,
): Promise<GithubActionResult<{ posted: number }>> {
  const pending = (await listIssueLinks(issueId)).filter(
    (l) => l.postedAt === null,
  );
  if (pending.length === 0) {
    return { ok: true, posted: 0 };
  }
  try {
    await createComment(
      cfg,
      githubNumber,
      composeReportsComment(pending.map((l) => l.quotedMd)),
    );
  } catch (err) {
    if (err instanceof GithubError) {
      return githubError(err, "comment");
    }
    throw err;
  }
  await markLinksPosted(
    issueId,
    pending.map((l) => l.feedbackId),
    Temporal.Now.instant(),
  );
  return { ok: true, posted: pending.length };
}

export async function attachSiteFeedbackToGithubIssueAction(
  input: SiteFeedbackAttachInput,
): Promise<GithubActionResult<{ issueId: string }>> {
  const principal = await requireSiteFeedbackManager();
  const cfg = getGithubConfig();
  if (cfg === null) {
    return NOT_CONFIGURED;
  }
  let remote;
  try {
    remote = await getGithubIssue(cfg, input.number);
  } catch (err) {
    if (err instanceof GithubError) {
      return {
        ok: false,
        reason: "github_error",
        message: `GitHub refused the lookup (${err.status}). Nothing was attached.`,
      };
    }
    throw err;
  }
  if (remote === null) {
    return {
      ok: false,
      reason: "not_found",
      message: `No issue #${input.number} in ${cfg.repo}`,
    };
  }
  if (remote.isPullRequest) {
    return {
      ok: false,
      reason: "pull_request",
      message: `#${input.number} is a pull request, not an issue`,
    };
  }

  const rows = await loadSubmissions(input.feedbackIds);
  const issueId = await upsertAttachedIssue({
    id: `sfi_${uuidv7()}`,
    number: remote.number,
    url: remote.url,
    title: remote.title,
    state: remote.state,
    createdBy: principal.userId,
    now: Temporal.Now.instant(),
  });
  const existing = new Set(
    await listLinkedFeedbackIds(
      issueId,
      rows.map((r) => r.id),
    ),
  );
  await insertLinks(
    issueId,
    rows
      .filter((row) => !existing.has(row.id))
      .map((row) => ({ feedbackId: row.id, quotedMd: quotedFor(row) })),
    principal.userId,
  );

  const posted = await postPending(cfg, issueId, remote.number);
  return posted.ok ? { ok: true, issueId } : posted;
}

export async function postPendingSiteFeedbackReportsAction(
  input: SiteFeedbackPostPendingInput,
): Promise<GithubActionResult<{ posted: number }>> {
  await requireSiteFeedbackManager();
  const cfg = getGithubConfig();
  if (cfg === null) {
    return NOT_CONFIGURED;
  }
  const row = await getIssueSummary(input.issueId);
  if (row === null) {
    return { ok: false, reason: "not_found", message: "Issue not found" };
  }
  if (row.githubNumber === null) {
    return {
      ok: false,
      reason: "not_found",
      message: "This issue hasn't been filed on GitHub yet",
    };
  }
  return postPending(cfg, input.issueId, row.githubNumber);
}

export type SyncSiteFeedbackIssuesResult =
  | { ok: true; checked: number; closed: number }
  | { ok: false; reason: "not_configured" };

/**
 * "Sync now" for managers. Unlike the cron entry point this lets a GitHub
 * failure propagate, so the button can show it.
 */
export async function syncSiteFeedbackIssuesAction(): Promise<SyncSiteFeedbackIssuesResult> {
  await requireSiteFeedbackManager();
  const cfg = getGithubConfig();
  if (cfg === null) {
    return { ok: false, reason: "not_configured" };
  }
  const { syncSiteFeedbackIssues } =
    await import("#/features/site-feedback/server/sync.server");
  return { ok: true, ...(await syncSiteFeedbackIssues(cfg)) };
}

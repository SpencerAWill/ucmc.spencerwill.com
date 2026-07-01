/**
 * Action implementations for feedback server fns. The shell in
 * `./feedback-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 */
import { uuidv7 } from "uuidv7";

import { composeFeedbackBody } from "#/features/feedback/server/format";
import { mirrorToGithub } from "#/features/feedback/server/github.server";
import type {
  FeedbackInput,
  FeedbackKind,
  FeedbackStatus,
  FeedbackStatusUpdateInput,
} from "#/features/feedback/server/limits";
import {
  getUserPublicId,
  insertFeedback,
  listAllFeedback,
  listFeedbackByUser,
  setGithubIssue,
  updateFeedbackStatus,
} from "#/features/feedback/server/repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { redactString } from "#/server/log/redact.server";
import { checkFeedbackRateLimit } from "#/server/rate-limit.server";
import { readSetting } from "#/server/settings/settings-repo.server";

// Strip query + fragment from a submitter-provided URL before it
// reaches D1 or the GitHub mirror. Submitters set `pageUrl` to
// `window.location.href`, which routinely carries tokens / emails in
// query params on auth-callback-shaped routes; mirroring those into
// a public-ish issue tracker would leak. Keep origin + pathname so
// the routing context is still useful in triage.
function normalizePageUrl(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

// ── auth helpers ────────────────────────────────────────────────────────

async function requireFeedbackSubmitter(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("feedback:submit")) {
    throw new Error("Forbidden: missing feedback:submit");
  }
  return principal;
}

async function requireFeedbackManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("feedback:manage")) {
    throw new Error("Forbidden: missing feedback:manage");
  }
  return principal;
}

// ── public types ────────────────────────────────────────────────────────

export interface FeedbackSummary {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  pageUrl: string | null;
  createdBy: string | null;
  createdByPublicId: string | null;
  authorDisplayName: string | null;
  authorAvatarKey: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
}

function toSummary(row: {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  pageUrl: string | null;
  createdBy: string | null;
  createdByPublicId: string | null;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
}): FeedbackSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    pageUrl: row.pageUrl,
    createdBy: row.createdBy,
    createdByPublicId: row.createdByPublicId,
    authorDisplayName:
      row.authorPreferredName ?? row.authorFullName ?? row.authorEmail ?? null,
    authorAvatarKey: row.authorAvatarKey,
    githubIssueNumber: row.githubIssueNumber,
    githubIssueUrl: row.githubIssueUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listMyFeedbackAction(): Promise<FeedbackSummary[]> {
  const principal = await requireFeedbackSubmitter();
  const rows = await listFeedbackByUser(principal.userId);
  return rows.map(toSummary);
}

export async function listAllFeedbackAction(): Promise<FeedbackSummary[]> {
  await requireFeedbackManager();
  const rows = await listAllFeedback();
  return rows.map(toSummary);
}

export async function submitFeedbackAction(
  input: FeedbackInput,
): Promise<{ id: string }> {
  const principal = await requireFeedbackSubmitter();
  // Runtime kill switch. Admins flip this off when they need to pause
  // the website-feedback intake (e.g. while triaging a backlog) without
  // also nuking the GitHub mirror or revoking everyone's permission.
  // The `*:manage` permission keeps managers' access to the triage view
  // intact regardless — this gate is on **submissions**, not reads.
  const enabled = await readSetting("feedback.website_enabled");
  if (!enabled) {
    throw new Error("Website feedback submissions are currently disabled.");
  }
  const allowed = await checkFeedbackRateLimit(principal.userId);
  if (!allowed) {
    throw new Error("Rate limit exceeded — please try again in a minute.");
  }

  const id = `fb_${uuidv7()}`;
  const pageUrl = normalizePageUrl(input.pageUrl);
  const userAgent = input.userAgent?.trim() ? input.userAgent.trim() : null;
  const body = composeFeedbackBody(input);

  await insertFeedback({
    id,
    kind: input.kind,
    title: input.title,
    body,
    pageUrl,
    userAgent,
    createdBy: principal.userId,
  });

  // Best-effort GitHub mirror. mirrorToGithub already swallows failures
  // and returns null; we wrap setGithubIssue too because a write back to
  // D1 must never poison the user's success path either.
  try {
    const submitterPublicId = await getUserPublicId(principal.userId);
    const result = await mirrorToGithub({
      kind: input.kind,
      title: input.title,
      body,
      submitterPublicId,
      pageUrl,
    });
    if (result) {
      await setGithubIssue(id, result.number, result.url);
    }
  } catch (err) {
    console.error(
      `[feedback] mirror/setGithubIssue failed: ${redactString(String(err))}`,
    );
  }

  return { id };
}

export async function updateFeedbackStatusAction(
  input: FeedbackStatusUpdateInput,
): Promise<{ ok: true }> {
  await requireFeedbackManager();
  await updateFeedbackStatus(input);
  return { ok: true };
}

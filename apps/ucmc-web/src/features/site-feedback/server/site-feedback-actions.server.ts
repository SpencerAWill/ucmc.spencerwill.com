/**
 * Action implementations for feedback server fns. The shell in
 * `./site-feedback-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 */
import { uuidv7 } from "uuidv7";

import { composeSiteFeedbackBody } from "#/features/site-feedback/server/format";
import type {
  SiteFeedbackInput,
  SiteFeedbackKind,
  SiteFeedbackStatus,
  SiteFeedbackStatusUpdateInput,
} from "#/features/site-feedback/server/limits";
import {
  insertSiteFeedback,
  listAllSiteFeedback,
  listSiteFeedbackByUser,
  updateSiteFeedbackStatus,
} from "#/features/site-feedback/server/repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { checkSiteFeedbackRateLimit } from "#/server/rate-limit.server";
import { readSetting } from "#/server/settings/settings-repo.server";

// Strip query + fragment from a submitter-provided URL before it
// reaches D1. Submitters set `pageUrl` to `window.location.href`,
// which routinely carries tokens / emails in query params on
// auth-callback-shaped routes; storing those would leak them to every
// triager (and to any GitHub issue a maintainer later drafts from them).
// Keep origin + pathname so the routing context is still useful in triage.
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

async function requireSiteFeedbackSubmitter(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("site_feedback:submit")) {
    throw new Error("Forbidden: missing site_feedback:submit");
  }
  return principal;
}

async function requireSiteFeedbackManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("site_feedback:manage")) {
    throw new Error("Forbidden: missing site_feedback:manage");
  }
  return principal;
}

// ── public types ────────────────────────────────────────────────────────

export interface SiteFeedbackSummary {
  id: string;
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  status: SiteFeedbackStatus;
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
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  status: SiteFeedbackStatus;
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
}): SiteFeedbackSummary {
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

export async function listMySiteFeedbackAction(): Promise<
  SiteFeedbackSummary[]
> {
  const principal = await requireSiteFeedbackSubmitter();
  const rows = await listSiteFeedbackByUser(principal.userId);
  return rows.map(toSummary);
}

export async function listAllSiteFeedbackAction(): Promise<
  SiteFeedbackSummary[]
> {
  await requireSiteFeedbackManager();
  const rows = await listAllSiteFeedback();
  return rows.map(toSummary);
}

export async function submitSiteFeedbackAction(
  input: SiteFeedbackInput,
): Promise<{ id: string }> {
  const principal = await requireSiteFeedbackSubmitter();
  // Runtime kill switch. Admins flip this off when they need to pause
  // the site-feedback intake (e.g. while triaging a backlog) without
  // also revoking everyone's permission.
  // The `*:manage` permission keeps managers' access to the triage view
  // intact regardless — this gate is on **submissions**, not reads.
  const enabled = await readSetting("feedback.site_enabled");
  if (!enabled) {
    throw new Error("Site feedback submissions are currently disabled.");
  }
  const allowed = await checkSiteFeedbackRateLimit(principal.userId);
  if (!allowed) {
    throw new Error("Rate limit exceeded — please try again in a minute.");
  }

  const id = `sfb_${uuidv7()}`;
  const pageUrl = normalizePageUrl(input.pageUrl);
  const userAgent = input.userAgent?.trim() ? input.userAgent.trim() : null;
  const body = composeSiteFeedbackBody(input);

  await insertSiteFeedback({
    id,
    kind: input.kind,
    title: input.title,
    body,
    pageUrl,
    userAgent,
    createdBy: principal.userId,
  });

  return { id };
}

export async function updateSiteFeedbackStatusAction(
  input: SiteFeedbackStatusUpdateInput,
): Promise<{ ok: true }> {
  await requireSiteFeedbackManager();
  await updateSiteFeedbackStatus(input);
  return { ok: true };
}

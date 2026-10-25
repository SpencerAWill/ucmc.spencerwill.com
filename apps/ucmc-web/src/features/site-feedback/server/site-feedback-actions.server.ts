/**
 * Action implementations for feedback server fns. The shell in
 * `./site-feedback-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 */
import { uuidv7 } from "uuidv7";

import { composeSiteFeedbackBody } from "#/features/site-feedback/server/format";
import { SITE_FEEDBACK_SCREENSHOT_MAX_BYTES } from "#/features/site-feedback/server/limits";
import type {
  SiteFeedbackInput,
  SiteFeedbackKind,
  SiteFeedbackState,
  SiteFeedbackStatus,
} from "#/features/site-feedback/server/limits";
import {
  insertSiteFeedback,
  listSiteFeedbackByUser,
} from "#/features/site-feedback/server/repo.server";
import {
  countFeedbackInStates,
  countMyFeedbackInStates,
  listIssuesForFeedback,
} from "#/features/site-feedback/server/triage-repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { decodeImageDataUrl } from "#/server/r2/image-data-url.server";
import {
  deleteSiteFeedbackScreenshots,
  putSiteFeedbackScreenshot,
  siteFeedbackScreenshotKey,
} from "#/server/r2/site-feedback-screenshots.server";
import {
  checkSiteFeedbackRateLimit,
  checkUploadRateLimit,
} from "#/server/rate-limit.server";
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

export async function requireSiteFeedbackManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("site_feedback:manage")) {
    throw new Error("Forbidden: missing site_feedback:manage");
  }
  return principal;
}

async function requireSiteFeedbackViewer(): Promise<{
  principal: Principal;
  canManage: boolean;
}> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  const canManage = principal.permissions.includes("site_feedback:manage");
  if (!canManage && !principal.permissions.includes("site_feedback:submit")) {
    throw new Error("Forbidden: missing site_feedback:submit");
  }
  return { principal, canManage };
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
  /** Derived on read. Submitters never see `in_draft`; it reads as `new`. */
  state: SiteFeedbackState;
  /** Filed GitHub issues only, never drafts. */
  trackedIn: { number: number; url: string }[];
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
}

export interface SiteFeedbackOverview {
  mineOpen: number;
  mineTracked: number;
  /** `null` unless the caller holds `site_feedback:manage`. */
  untriaged: number | null;
}

function toSummary(
  row: {
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
    state: SiteFeedbackState;
    createdAt: Temporal.Instant;
    updatedAt: Temporal.Instant;
  },
  options: {
    hideDrafts: boolean;
    trackedIn: { number: number; url: string }[];
  },
): SiteFeedbackSummary {
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
    state: options.hideDrafts && row.state === "in_draft" ? "new" : row.state,
    trackedIn: options.trackedIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Summaries with their filed issues attached (one query for the page). */
async function toSummaries(
  rows: Parameters<typeof toSummary>[0][],
  hideDrafts: boolean,
): Promise<SiteFeedbackSummary[]> {
  const links = await listIssuesForFeedback(rows.map((r) => r.id));
  const byFeedback = new Map<string, { number: number; url: string }[]>();
  for (const link of links) {
    if (
      link.state === "draft" ||
      link.githubNumber === null ||
      link.githubUrl === null
    ) {
      continue;
    }
    const list = byFeedback.get(link.feedbackId) ?? [];
    list.push({ number: link.githubNumber, url: link.githubUrl });
    byFeedback.set(link.feedbackId, list);
  }
  return rows.map((row) =>
    toSummary(row, { hideDrafts, trackedIn: byFeedback.get(row.id) ?? [] }),
  );
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listMySiteFeedbackAction(): Promise<
  SiteFeedbackSummary[]
> {
  const principal = await requireSiteFeedbackSubmitter();
  const rows = await listSiteFeedbackByUser(principal.userId);
  return toSummaries(rows, true);
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
  const enabled = await readSetting("site_feedback.submissions_enabled");
  if (!enabled) {
    throw new Error("Site feedback submissions are currently disabled.");
  }
  const allowed = await checkSiteFeedbackRateLimit(principal.userId);
  if (!allowed) {
    throw new Error("Rate limit exceeded — please try again in a minute.");
  }

  const id = `sfb_${uuidv7()}`;
  // Every refusal happens before the upload, so a refused submission
  // never leaves an object behind.
  const screenshot = input.screenshotDataUrl
    ? await prepareScreenshot(principal.userId, id, input.screenshotDataUrl)
    : null;
  const pageUrl = normalizePageUrl(input.pageUrl);
  const userAgent = input.userAgent?.trim() ? input.userAgent.trim() : null;
  const body = composeSiteFeedbackBody(input);

  if (screenshot) {
    await putSiteFeedbackScreenshot(
      screenshot.key,
      screenshot.bytes,
      screenshot.contentType,
    );
  }
  try {
    await insertSiteFeedback({
      id,
      kind: input.kind,
      title: input.title,
      body,
      pageUrl,
      userAgent,
      createdBy: principal.userId,
      screenshotKey: screenshot?.key ?? null,
      screenshotBytes: screenshot?.bytes.byteLength ?? null,
    });
  } catch (err) {
    // The orphan sweep would catch it too, but not for a day.
    if (screenshot) {
      await deleteSiteFeedbackScreenshots([screenshot.key]);
    }
    throw err;
  }

  return { id };
}

/**
 * Checks a screenshot against the upload budget and decodes it (webp or
 * jpeg, magic bytes, the 1 MB cap). Throws on any refusal; writes nothing.
 */
async function prepareScreenshot(
  userId: string,
  feedbackId: string,
  dataUrl: string,
): Promise<{
  key: string;
  bytes: ArrayBuffer;
  contentType: "image/webp" | "image/jpeg";
}> {
  if (!(await checkUploadRateLimit(userId))) {
    throw new Error("Too many screenshot uploads, try again in a minute.");
  }
  const decoded = decodeImageDataUrl(dataUrl, {
    allowed: ["image/webp", "image/jpeg"],
    maxBytes: SITE_FEEDBACK_SCREENSHOT_MAX_BYTES,
  });
  // `allowed` admits only these two.
  const contentType = decoded.contentType as "image/webp" | "image/jpeg";
  return {
    key: siteFeedbackScreenshotKey(feedbackId, contentType),
    bytes: decoded.bytes,
    contentType,
  };
}

export async function getSiteFeedbackOverviewAction(): Promise<SiteFeedbackOverview> {
  const { principal, canManage } = await requireSiteFeedbackViewer();
  // A submitter's in-draft rows read as New to them, so they count as open.
  const [mineOpen, mineTracked, untriaged] = await Promise.all([
    countMyFeedbackInStates(principal.userId, ["new", "in_draft"]),
    countMyFeedbackInStates(principal.userId, ["tracked"]),
    canManage ? countFeedbackInStates(["new"]) : Promise.resolve(null),
  ]);
  return { mineOpen, mineTracked, untriaged };
}

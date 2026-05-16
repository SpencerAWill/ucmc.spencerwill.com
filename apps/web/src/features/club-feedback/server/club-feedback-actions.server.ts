/**
 * Action implementations for club-feedback server fns. The shell in
 * `./club-feedback-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 *
 * Parallel to feedback-actions.server.ts; intentional differences:
 *
 *   - No GitHub mirror. Club feedback is governance-internal and must
 *     never leak to a public-ish issue tracker.
 *   - Anonymity. Submitters can opt in to hiding their identity from
 *     officers in the triage view. `createdBy` is still recorded so
 *     per-user rate limiting + abuse handling stay possible; the
 *     redaction is applied here when projecting summaries for managers,
 *     so the FK never reaches the client. Owners always see their own
 *     rows un-redacted in the "Your submissions" list.
 *   - Submission gate. `feedback.club_enabled` controls whether new
 *     submissions are accepted; managers retain full triage access
 *     regardless (separate `club_feedback:manage` permission).
 */
import { uuidv7 } from "uuidv7";

import type {
  ClubFeedbackInput,
  ClubFeedbackKind,
  ClubFeedbackStatus,
  ClubFeedbackStatusUpdateInput,
} from "#/features/club-feedback/server/limits";
import {
  insertClubFeedback,
  listAllClubFeedback,
  listClubFeedbackByUser,
  updateClubFeedbackStatus,
} from "#/features/club-feedback/server/repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { checkClubFeedbackRateLimit } from "#/server/rate-limit.server";
import { readSetting } from "#/server/settings/settings-repo.server";

// ── auth helpers ────────────────────────────────────────────────────────

async function requireClubFeedbackSubmitter(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("club_feedback:submit")) {
    throw new Error("Forbidden: missing club_feedback:submit");
  }
  return principal;
}

async function requireClubFeedbackManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("club_feedback:manage")) {
    throw new Error("Forbidden: missing club_feedback:manage");
  }
  return principal;
}

// ── public types ────────────────────────────────────────────────────────

export interface ClubFeedbackSummary {
  id: string;
  kind: ClubFeedbackKind;
  title: string;
  body: string;
  status: ClubFeedbackStatus;
  anonymous: boolean;
  // `null` when the row is anonymous and the viewer isn't the owner.
  // Always populated when the viewer is the submitter.
  createdBy: string | null;
  createdByPublicId: string | null;
  authorDisplayName: string | null;
  authorAvatarKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Row = {
  id: string;
  kind: ClubFeedbackKind;
  title: string;
  body: string;
  status: ClubFeedbackStatus;
  anonymous: boolean;
  createdBy: string | null;
  createdByPublicId: string | null;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Project a row to a summary, optionally redacting submitter columns when
// the row is anonymous and the viewer is not the owner. We strip both
// `createdBy` and the joined name/avatar/publicId so the wire payload
// itself carries no identity — defense in depth against a UI bug that
// renders a "hidden" field somewhere.
function toSummary(row: Row, viewerUserId: string | null): ClubFeedbackSummary {
  const redact = row.anonymous && row.createdBy !== viewerUserId;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    anonymous: row.anonymous,
    createdBy: redact ? null : row.createdBy,
    createdByPublicId: redact ? null : row.createdByPublicId,
    authorDisplayName: redact
      ? null
      : (row.authorPreferredName ??
        row.authorFullName ??
        row.authorEmail ??
        null),
    authorAvatarKey: redact ? null : row.authorAvatarKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listMyClubFeedbackAction(): Promise<
  ClubFeedbackSummary[]
> {
  const principal = await requireClubFeedbackSubmitter();
  const rows = await listClubFeedbackByUser(principal.userId);
  // The "my" list is always un-redacted — submitters need to see their
  // own row to know they sent it. Passing `principal.userId` to the
  // viewer arg means the redaction predicate never fires here.
  return rows.map((row) => toSummary(row, principal.userId));
}

export async function listAllClubFeedbackAction(): Promise<
  ClubFeedbackSummary[]
> {
  const principal = await requireClubFeedbackManager();
  const rows = await listAllClubFeedback();
  // Managers see anonymous rows with the submitter stripped. If a
  // manager happens to also be the submitter of one of their own
  // anonymous rows they still get the un-redacted shape for that
  // specific row (`createdBy === viewerUserId`), which is fine —
  // it would be silly to redact yourself from yourself.
  return rows.map((row) => toSummary(row, principal.userId));
}

export async function submitClubFeedbackAction(
  input: ClubFeedbackInput,
): Promise<{ id: string }> {
  const principal = await requireClubFeedbackSubmitter();
  const enabled = await readSetting("feedback.club_enabled");
  if (!enabled) {
    throw new Error("Club feedback submissions are currently disabled.");
  }
  const allowed = await checkClubFeedbackRateLimit(principal.userId);
  if (!allowed) {
    throw new Error("Rate limit exceeded — please try again in a minute.");
  }

  const id = `cfb_${uuidv7()}`;
  await insertClubFeedback({
    id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    anonymous: input.anonymous,
    createdBy: principal.userId,
  });

  return { id };
}

export async function updateClubFeedbackStatusAction(
  input: ClubFeedbackStatusUpdateInput,
): Promise<{ ok: true }> {
  await requireClubFeedbackManager();
  await updateClubFeedbackStatus(input);
  return { ok: true };
}

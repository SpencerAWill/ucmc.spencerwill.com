/**
 * Permission gates for the club calendar (issue #187).
 *
 * Two gates for two jobs, following /sponsors' shape:
 *
 *   - {@link requireEventManager} guards every write. One
 *     `events:manage` covers creating, editing, cancelling and
 *     per-occurrence overrides — an officer publishing a semester's
 *     schedule does all four in one sitting, and splitting them would
 *     mean four permissions for one person's one task.
 *
 *   - {@link viewerCanReadPrivate} is not a gate that throws; it
 *     answers a question the *read* asks, so the read can choose a
 *     visibility scope. Anonymous is a normal outcome, not an error —
 *     the public feed has no principal at all — so a missing principal
 *     returns `false`.
 *
 * **There is deliberately no `events:view`.** Being an approved member
 * is the qualification for the calendar page, as /trips already
 * decided; a third permission would be granted to `role_member` on day
 * one and never revoked from anyone.
 *
 * Both of these read the REAL principal, never the emulated one. That
 * asymmetry is correct and is the same one /sponsors documents: the
 * server decides what bytes leave the worker, and a role preview is a
 * client-side narrowing that must not be able to widen the payload. The
 * client re-asks `hasPermission("events:read_private")` before
 * rendering, which is what makes a sys admin previewing `member`
 * actually see a member's calendar.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireEventManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("events:manage")) {
    throw new Error("Forbidden: missing events:manage");
  }
  return principal;
}

/** Whether the current viewer may see `visibility = 'officers'` events. */
export async function viewerCanReadPrivate(): Promise<boolean> {
  const principal = await loadCurrentPrincipal();
  return principal?.permissions.includes("events:read_private") ?? false;
}

/**
 * Whether the current viewer is an approved member.
 *
 * Decides `members`-tier visibility. Reads `status` rather than a
 * permission because that is what approval *is* — the same test
 * `requireApproved` makes at the route layer, asked here without the
 * redirect so a read can narrow instead of bouncing.
 */
export async function viewerIsApprovedMember(): Promise<boolean> {
  const principal = await loadCurrentPrincipal();
  return principal?.status === "approved";
}

/**
 * Shared permission gates for `features/members/server/` action modules.
 * Lives in its own module so siblings (`member-actions.server.ts`,
 * `unclaimed-actions.server.ts`, future ones) don't need to cross-import
 * each other's full action surface just to share a single guard.
 */
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import type { Principal } from "#/server/auth/principal.server";

/**
 * Loads the current principal and asserts that they hold the
 * `members:manage` permission. Throws if unsigned-in or missing the
 * permission — callers treat the thrown error as a hard stop (the
 * shell maps it to a 403-style response shape).
 */
export async function requireMembersManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("members:manage")) {
    throw new Error("Forbidden: missing members:manage");
  }
  return principal;
}

/**
 * Permissions whose holders may open a member who isn't approved
 * (pending, rejected, deactivated) on `/members/$publicId`. Everyone else
 * sees approved members only, as on the directory, so an applicant's
 * email isn't readable by any member who learns their publicId (#381).
 *
 * - `members:manage` reviews applications and deactivations.
 * - `waivers:view` / `waivers:verify`: the detail page's waiver card is
 *   the only surface showing a deactivated member's attestation.
 * - `audit:view`: the audit log links to every member an entry names,
 *   whatever their status now.
 *
 * Reads the real principal, like every server action.
 */
const ANY_MEMBER_STATUS_PERMISSIONS = [
  "members:manage",
  "waivers:view",
  "waivers:verify",
  "audit:view",
] as const;

export function canViewAnyMemberStatus(principal: Principal): boolean {
  return ANY_MEMBER_STATUS_PERMISSIONS.some((p) =>
    principal.permissions.includes(p),
  );
}

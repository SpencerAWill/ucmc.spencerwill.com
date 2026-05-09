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
 * Loads the current principal and asserts that they hold the
 * `members:ban` permission. Distinct from `members:manage`: ban /
 * unban are gated behind the dedicated permission so the role gate
 * for "hard ouster + email blocklist" can diverge from generic member
 * lifecycle in the future without code changes.
 */
export async function requireMembersBanner(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("members:ban")) {
    throw new Error("Forbidden: missing members:ban");
  }
  return principal;
}

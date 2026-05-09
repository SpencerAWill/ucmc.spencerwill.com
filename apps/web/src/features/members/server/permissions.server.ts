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
 * `registrations:approve` permission. Throws if unsigned-in or missing
 * the permission — callers treat the thrown error as a hard stop (the
 * shell maps it to a 403-style response shape).
 */
export async function requireApprover(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("registrations:approve")) {
    throw new Error("Forbidden: missing registrations:approve");
  }
  return principal;
}

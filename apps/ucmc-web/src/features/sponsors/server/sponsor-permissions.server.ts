/**
 * Permission gates for /sponsors.
 *
 * Two gates, for two different jobs:
 *
 *   - {@link requireSponsorManager} guards every write. One
 *     `public_sponsors:manage` covers both markdown bands and the
 *     sponsor rows, exactly as `public_volunteer:manage` covers
 *     /volunteer's narrative, programs and outings — splitting it would
 *     mean several permissions for bands of one page that one officer
 *     edits in one sitting.
 *
 *   - {@link viewerHoldsPerks} is not a gate that throws; it answers a
 *     question the *read* asks, so the read can strip `memberPerk` from
 *     the payload for a viewer who shouldn't see it. Anonymous is a
 *     normal outcome here, not an error — /sponsors is a public page —
 *     so a missing principal returns `false` rather than throwing.
 *
 * `system_admin` auto-grants every permission via the bypass in
 * `principal.server.ts`, so the seed migration grants manage to no role;
 * officer roles pick it up at runtime when delegated at /access.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireSponsorManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("public_sponsors:manage")) {
    throw new Error("Forbidden: missing public_sponsors:manage");
  }
  return principal;
}

/**
 * Whether the current viewer may see member-only sponsor perks.
 *
 * **This asks the real principal, never the emulated one**, which is
 * the correct and deliberate asymmetry: the server's job is to decide
 * what bytes leave the worker, and a role preview is a client-side
 * narrowing that must not be able to *widen* what the server sends. The
 * client re-asks `hasPermission("public_sponsors:perks")` before
 * rendering, which is what makes a sys admin previewing `anonymous` see
 * the page an anonymous visitor sees even though the payload they were
 * served still carries the perks.
 */
export async function viewerHoldsPerks(): Promise<boolean> {
  const principal = await loadCurrentPrincipal();
  return principal?.permissions.includes("public_sponsors:perks") ?? false;
}

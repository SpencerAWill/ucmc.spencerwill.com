/**
 * Permission gate for /volunteer mutations.
 *
 * One `public_volunteer:manage` covers the whole page — the narrative
 * markdown, the program cards and the events — the same way
 * `history:manage` covers /history's narrative, officer archive and
 * honorary list. Splitting it would mean three permissions for three
 * bands of one page that one officer edits in one sitting.
 *
 * `system_admin` auto-grants every permission via the bypass in
 * `principal.server.ts`, so the seed migration grants this to no role;
 * officer roles pick it up at runtime when delegated at /access.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireVolunteerManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("public_volunteer:manage")) {
    throw new Error("Forbidden: missing public_volunteer:manage");
  }
  return principal;
}

/**
 * Permission gate for /gazette mutations. system_admin auto-grants
 * every permission via the bypass in `principal.server.ts`; officer
 * roles (Secretary in particular, since they own the newsletter) can
 * pick this up at runtime when delegated via /members/roles.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireGazetteManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("public_gazette:manage")) {
    throw new Error("Forbidden: missing public_gazette:manage");
  }
  return principal;
}

/**
 * Permission gate for the /settings admin page. system_admin auto-grants
 * every permission via the bypass in `principal.server.ts`; other roles
 * pick this up at runtime via /members/roles when delegated.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireSettingsManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("settings:manage")) {
    throw new Error("Forbidden: missing settings:manage");
  }
  return principal;
}

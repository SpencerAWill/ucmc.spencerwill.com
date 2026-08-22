/**
 * Permission gate for /history mutations. system_admin auto-grants
 * every permission via the bypass in `principal.server.ts`; officer
 * roles (President, Secretary, etc.) pick this up at runtime when
 * delegated via /access.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireHistoryManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("history:manage")) {
    throw new Error("Forbidden: missing history:manage");
  }
  return principal;
}

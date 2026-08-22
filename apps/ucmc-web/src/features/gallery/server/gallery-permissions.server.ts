/**
 * Permission gate for /gallery mutations. system_admin auto-grants
 * every permission via the bypass in `principal.server.ts`; officer
 * roles can pick this up at runtime when delegated via /access.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireGalleryManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("public_gallery:manage")) {
    throw new Error("Forbidden: missing public_gallery:manage");
  }
  return principal;
}

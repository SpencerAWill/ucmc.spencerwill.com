/**
 * Permission gate for /album mutations. system_admin auto-grants
 * every permission via the bypass in `principal.server.ts`; officer
 * roles can pick this up at runtime when delegated via /access.
 */
import { effectivePermissions } from "#/server/auth/emulation";
import { readViewAsCookie } from "#/server/auth/emulation-cookie.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

export async function requireAlbumManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("public_album:manage")) {
    throw new Error("Forbidden: missing public_album:manage");
  }
  return principal;
}

/**
 * Whether the viewer may open the full-size Album photo. Reads the
 * emulated permission set, never `principal.permissions`, so a manager
 * previewing a lesser role is refused too. `[]` for the anonymous role,
 * as the screenshot action passes: this permission is never
 * `anonymous_grantable`, so the role can't contribute it.
 */
export function canViewAlbumOriginal(principal: Principal): boolean {
  return effectivePermissions(principal, readViewAsCookie(), []).includes(
    "public_album:view_original",
  );
}

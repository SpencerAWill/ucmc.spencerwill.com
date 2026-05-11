/**
 * Shared permission gates for `features/gear/server/` action modules.
 * `requireGearReader` is the floor for browsing /gear; `requireGearManager`
 * gates every write (create, edit, retire, bulk import, type/tag changes).
 */
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import type { Principal } from "#/server/auth/principal.server";

export async function requireGearReader(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("gear:read")) {
    throw new Error("Forbidden: missing gear:read");
  }
  return principal;
}

export async function requireGearManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("gear:manage")) {
    throw new Error("Forbidden: missing gear:manage");
  }
  return principal;
}

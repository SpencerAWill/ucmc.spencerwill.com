/**
 * Shared permission gates for `features/gear/server/` action modules.
 * `requireGearReader` is the floor for browsing /gear; `requireGearManager`
 * gates catalog writes (create, edit, retire, bulk import, type/tag
 * changes); `requireGearInspector` gates the append-only inspection log,
 * which is delegable on its own.
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

/**
 * Authorize recording an append-only gear inspection. Accepts
 * `gear:inspect` OR `gear:manage`: the narrow permission exists so a
 * trip leader can log "this rope failed" without also holding the power
 * to retire pieces, edit the catalog, or bulk-import inventory, while
 * existing inventory managers keep the ability they already had. The OR
 * lives here rather than at the call site — there is no permission
 * implication mechanism in this codebase.
 */
export async function requireGearInspector(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  const canInspect =
    principal.permissions.includes("gear:inspect") ||
    principal.permissions.includes("gear:manage");
  if (!canInspect) {
    throw new Error("Forbidden: missing gear:inspect");
  }
  return principal;
}

/**
 * Authorize a gear-cave keeper running the checkout / check-in desk.
 * Intentionally distinct from `gear:manage` so the desk authority can
 * be delegated independently of full inventory CRUD. system_admin
 * gets it via the role-bypass in `principal.server.ts`.
 */
export async function requireGearLoanManager(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("gear:loan")) {
    throw new Error("Forbidden: missing gear:loan");
  }
  return principal;
}

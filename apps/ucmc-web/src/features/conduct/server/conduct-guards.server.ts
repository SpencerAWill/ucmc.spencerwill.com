/**
 * Permission guards for conduct actions, shaped like club feedback's
 * `require*` helpers. They check the real principal: server actions
 * never honour a role preview.
 *
 * There is no implication between the three: the seed grants
 * `conduct:view` to every `conduct:manage` holder explicitly.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

async function requireConductPermission(
  permission: "conduct:view" | "conduct:manage" | "conduct:report",
): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes(permission)) {
    throw new Error(`Forbidden: missing ${permission}`);
  }
  return principal;
}

export function requireConductViewer(): Promise<Principal> {
  return requireConductPermission("conduct:view");
}

export function requireConductManager(): Promise<Principal> {
  return requireConductPermission("conduct:manage");
}

export function requireConductReporter(): Promise<Principal> {
  return requireConductPermission("conduct:report");
}

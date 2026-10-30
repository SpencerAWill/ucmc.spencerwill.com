/**
 * Server-side half of the route guard `requireViewPermission` (in
 * `features/auth/guards.ts`, which takes a QueryClient and so can't run
 * here). A public page's read action calls this so the route guard
 * isn't the only enforcement point: a direct call to its server fn
 * can't read content an operator has taken off the anonymous role
 * (#381).
 *
 * Granted when the `anonymous` role holds the permission (signing in
 * never hides a public page, and a pending account holds no roles yet),
 * or the signed-in principal does. The anonymous set is KV-cached, so
 * checking it first keeps the common case off D1.
 */
import { loadAnonymousPermissions } from "#/server/auth/principal.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

/**
 * The rule itself, for a viewer other than the session's: the `.ics`
 * feed passes its token's owner, or nobody for `public.ics`. `viewer`
 * is a loader so the principal is only fetched when the anonymous role
 * doesn't settle it.
 */
export async function canView(
  permission: string,
  viewer: () => Promise<Principal | null>,
): Promise<boolean> {
  const anonPerms = await loadAnonymousPermissions();
  if (anonPerms.includes(permission)) {
    return true;
  }
  const principal = await viewer();
  return principal?.permissions.includes(permission) ?? false;
}

export async function assertCanView(permission: string): Promise<void> {
  if (!(await canView(permission, loadCurrentPrincipal))) {
    throw new Error(`Forbidden: missing ${permission}`);
  }
}

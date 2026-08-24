/**
 * Role emulation ("View as") — the isomorphic half.
 *
 * A sys admin (or anyone holding more than one role) can preview the
 * site as one specific role. This module owns the two rules that every
 * consumer has to agree on: which requested role counts as active, and
 * which permission set a preview therefore implies.
 *
 * **This is a preview, not a privilege drop.** Server actions always
 * enforce the real principal — `requireSettingsManager` and friends read
 * `principal.permissions`, which this never touches. What emulation
 * changes is what the *client* draws and which routes the *client-side*
 * guards let you reach, so an admin can see the member's experience
 * without a second account.
 *
 * It can only ever narrow, never widen, and that property is structural
 * rather than enforced here: `rolePermissionMap` is assembled server-side
 * in `principal.server.ts` and contains every role on the site *only*
 * for system admins — for everyone else it holds the user's own roles.
 * A requested role absent from that map is ignored, so forging the
 * cookie to `system_admin` as a regular member resolves to `null` and
 * falls back to the real permission set.
 *
 * Lives in `src/server/auth/` beside `session-config.ts` — a plain
 * (non-`.server.ts`) module both sides import, so the cookie name can't
 * drift between the server that reads it and the client that writes it.
 */
import type { Principal } from "#/server/auth/principal.server";

/**
 * Client-written, server-read, so it deliberately is NOT `httpOnly` —
 * the switcher sets it from `document.cookie`. No `__Host-` prefix
 * either: that requires `Secure`, which local http dev can't set, and
 * unlike the session cookie this value is not a credential (see the
 * narrowing note above), so the prefix would buy nothing.
 */
export const VIEW_AS_COOKIE_NAME = "ucmc_view_as";

/**
 * The role a preview is actually running as, or `null` for "real
 * permissions". Validated against `rolePermissionMap` rather than
 * `principal.roles`, because a sys admin may preview a role they don't
 * personally hold — `roles.includes()` would reject every one of them.
 */
export function resolveEmulatedRole(
  principal: Principal | null,
  requested: string | null | undefined,
): string | null {
  if (!principal || !requested) {
    return null;
  }
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a
  // forged cookie of `constructor` / `toString` / `__proto__` would
  // resolve as a real role and `effectivePermissions` would hand back a
  // function. Every consumer immediately calls `.includes()` on that,
  // which throws in render *and* in server-side `beforeLoad` — and the
  // cookie lasts a year, so it would be a persistent self-inflicted
  // break rather than a transient one.
  return Object.hasOwn(principal.rolePermissionMap, requested)
    ? requested
    : null;
}

/**
 * The permission set a viewer should be *shown* — the emulated role's
 * grants while previewing, the real set otherwise.
 *
 * Every client-side permission question routes through here (both
 * `useAuth` predicates and the route guards) so the chrome and the
 * guards can't disagree about what the preview allows. `anonymous`
 * callers have no principal and no preview; they keep their own list.
 */
export function effectivePermissions(
  principal: Principal,
  requested: string | null | undefined,
): string[] {
  const role = resolveEmulatedRole(principal, requested);
  return role ? principal.rolePermissionMap[role] : principal.permissions;
}

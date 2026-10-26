/**
 * Permission gates for the /settings admin surface. system_admin
 * auto-grants every permission via the bypass in `principal.server.ts`;
 * other roles pick these up at runtime via /access when delegated.
 *
 * The page is gated per key: each setting names the permission that edits
 * it (`settingPermissionOf`, default `settings:manage`). A write or a
 * history read checks the key it touches; the page-wide reads only need
 * the caller to hold one of `SETTINGS_PAGE_PERMISSIONS`.
 */
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import {
  SETTINGS_PAGE_PERMISSIONS,
  settingPermissionOf,
} from "#/server/settings/settings-registry";
import type { SettingKey } from "#/server/settings/settings-registry";

async function requireSignedIn(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  return principal;
}

/** The caller may edit `key`. */
export async function requireSettingPermission(
  key: SettingKey,
): Promise<Principal> {
  const principal = await requireSignedIn();
  const permission = settingPermissionOf(key);
  if (!principal.permissions.includes(permission)) {
    throw new Error(`Forbidden: missing ${permission}`);
  }
  return principal;
}

/**
 * The caller may edit at least one setting. The error names
 * `settings:manage` because that is the permission that opens the page
 * for everyone it was built for; a narrower one is a delegation.
 */
export async function requireAnySettingPermission(): Promise<Principal> {
  const principal = await requireSignedIn();
  if (
    !SETTINGS_PAGE_PERMISSIONS.some((permission) =>
      principal.permissions.includes(permission),
    )
  ) {
    throw new Error("Forbidden: missing settings:manage");
  }
  return principal;
}

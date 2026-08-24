import { describe, expect, it } from "vitest";

import {
  effectivePermissions,
  resolveEmulatedRole,
} from "#/server/auth/emulation";
import type { Principal } from "#/server/auth/principal.server";

/**
 * `rolePermissionMap` is the whole security story: `principal.server.ts`
 * fills it with every role on the site for a sys admin, and with the
 * user's own roles for everyone else. These tests pin the consequence —
 * a preview can only ever narrow.
 */
function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "u1",
    primaryEmail: "a@example.com",
    emails: ["a@example.com"],
    status: "approved",
    hasProfile: true,
    avatarKey: null,
    roles: ["member"],
    isSystemAdmin: false,
    permissions: ["gear:read"],
    rolePermissionMap: { member: ["gear:read"] },
    roleDisplayNames: { member: "Member" },
    ...overrides,
  };
}

const sysAdmin = principal({
  roles: ["system_admin"],
  isSystemAdmin: true,
  permissions: ["settings:manage", "waivers:verify", "gear:read"],
  rolePermissionMap: {
    system_admin: ["settings:manage", "waivers:verify", "gear:read"],
    member: ["gear:read"],
    treasurer: ["waivers:verify"],
  },
});

describe("resolveEmulatedRole", () => {
  it("accepts a role the principal's map describes", () => {
    expect(resolveEmulatedRole(sysAdmin, "treasurer")).toBe("treasurer");
  });

  it("accepts a role a sys admin doesn't personally hold", () => {
    // The map, not `roles`, is the validation set — a sys admin holds
    // only `system_admin` but may preview anything on the site.
    expect(sysAdmin.roles).not.toContain("treasurer");
    expect(resolveEmulatedRole(sysAdmin, "treasurer")).toBe("treasurer");
  });

  it("ignores a role absent from the map", () => {
    // The forged-cookie case for a regular member: their map holds only
    // their own roles, so asking for `system_admin` resolves to null and
    // the caller falls back to their real permissions.
    const member = principal();
    expect(resolveEmulatedRole(member, "system_admin")).toBeNull();
  });

  it("ignores empty and absent requests, and any request without a principal", () => {
    expect(resolveEmulatedRole(sysAdmin, null)).toBeNull();
    expect(resolveEmulatedRole(sysAdmin, "")).toBeNull();
    expect(resolveEmulatedRole(sysAdmin, undefined)).toBeNull();
    expect(resolveEmulatedRole(null, "system_admin")).toBeNull();
  });
});

describe("prototype keys", () => {
  // The cookie is client-written and lasts a year, so a value that
  // resolves to something off `Object.prototype` isn't a transient
  // annoyance: `effectivePermissions` would return a *function*, and
  // every consumer calls `.includes()` on the result — in render and in
  // server-side `beforeLoad` alike.
  const protoKeys = ["constructor", "toString", "valueOf", "__proto__"];

  it.each(protoKeys)("ignores %s as a requested role", (key) => {
    expect(resolveEmulatedRole(sysAdmin, key)).toBeNull();
  });

  it.each(protoKeys)("keeps %s from yielding a non-array", (key) => {
    const granted = effectivePermissions(sysAdmin, key);
    expect(Array.isArray(granted)).toBe(true);
    expect(granted).toEqual(sysAdmin.permissions);
  });
});

describe("effectivePermissions", () => {
  it("returns the real set when nothing is being previewed", () => {
    expect(effectivePermissions(sysAdmin, null)).toEqual(sysAdmin.permissions);
  });

  it("returns the previewed role's grants, dropping the rest", () => {
    const granted = effectivePermissions(sysAdmin, "member");
    expect(granted).toEqual(["gear:read"]);
    expect(granted).not.toContain("settings:manage");
  });

  it("can only narrow — a forged role never widens the set", () => {
    const member = principal();
    // Asking to "preview" a role that would grant more falls back to the
    // member's own permissions rather than granting anything.
    expect(effectivePermissions(member, "system_admin")).toEqual(["gear:read"]);
  });

  it("is a subset of the real permissions for every previewable role", () => {
    const real = new Set(sysAdmin.permissions);
    for (const role of Object.keys(sysAdmin.rolePermissionMap)) {
      for (const perm of effectivePermissions(sysAdmin, role)) {
        expect(real.has(perm)).toBe(true);
      }
    }
  });
});

/**
 * Pins the outcome of the permission renames + splits in migration 0064.
 *
 * The rename technique is the thing worth protecting: `permissions.name`
 * is what code checks, but `permissions.id` is what `role_permissions`
 * FKs to AND what `role.permissions_set` audit rows carry in their
 * `permissionIds` metadata. Renaming a permission by UPDATEing `name`
 * (id untouched) preserves every delegated grant and keeps audit history
 * resolvable; re-keying the id would silently orphan both. If someone
 * "tidies up" the ids later, these assertions fail loudly.
 */
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb, schema } from "#/server/db";

describe("permission catalog", () => {
  it("renames landed on `name`, leaving the `perm_*` ids intact", async () => {
    const rows = await getDb()
      .select({ id: schema.permissions.id, name: schema.permissions.name })
      .from(schema.permissions)
      .orderBy(asc(schema.permissions.name));
    const nameById = new Map(rows.map((r) => [r.id, r.name]));

    expect(nameById.get("perm_feedback_submit")).toBe("site_feedback:submit");
    expect(nameById.get("perm_feedback_manage")).toBe("site_feedback:manage");
    expect(nameById.get("perm_landing_edit")).toBe("landing:manage");

    const names = rows.map((r) => r.name);
    expect(names).not.toContain("feedback:submit");
    expect(names).not.toContain("feedback:manage");
    expect(names).not.toContain("landing:edit");
  });

  it("registers the two split permissions", async () => {
    const rows = await getDb()
      .select({ id: schema.permissions.id, name: schema.permissions.name })
      .from(schema.permissions);
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    expect(nameById.get("perm_waivers_view")).toBe("waivers:view");
    expect(nameById.get("perm_gear_inspect")).toBe("gear:inspect");
  });

  it("grants waivers:view to president, treasurer, and advisor", async () => {
    const rows = await getDb()
      .select({ role: schema.roles.name })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.roles,
        eq(schema.roles.id, schema.rolePermissions.roleId),
      )
      .where(eq(schema.rolePermissions.permissionId, "perm_waivers_view"))
      .orderBy(asc(schema.roles.name));
    expect(rows.map((r) => r.role)).toEqual([
      "advisor",
      "president",
      "treasurer",
    ]);
  });

  it("pins the volunteer permission ids to their names", async () => {
    const rows = await getDb()
      .select({ id: schema.permissions.id, name: schema.permissions.name })
      .from(schema.permissions);
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    expect(nameById.get("perm_public_volunteer_view")).toBe(
      "public_volunteer:view",
    );
    expect(nameById.get("perm_public_volunteer_manage")).toBe(
      "public_volunteer:manage",
    );
  });

  it("grants public_volunteer:view to anonymous AND member", async () => {
    // Both, so revoking the anonymous grant to take the page private
    // doesn't also lock members out of it.
    const rows = await getDb()
      .select({ roleId: schema.rolePermissions.roleId })
      .from(schema.rolePermissions)
      .where(
        eq(schema.rolePermissions.permissionId, "perm_public_volunteer_view"),
      )
      .orderBy(asc(schema.rolePermissions.roleId));
    expect(rows.map((r) => r.roleId)).toEqual([
      "role_anonymous",
      "role_member",
    ]);
  });

  it("leaves public_volunteer:manage ungranted — it exists to be delegated", async () => {
    // system_admin already holds it through the bypass in
    // principal.server.ts, so a seeded grant would only duplicate an
    // authority it has.
    const rows = await getDb()
      .select({ roleId: schema.rolePermissions.roleId })
      .from(schema.rolePermissions)
      .where(
        eq(schema.rolePermissions.permissionId, "perm_public_volunteer_manage"),
      );
    expect(rows).toEqual([]);
  });

  it("leaves gear:inspect ungranted — it exists to be delegated", async () => {
    // `gear:manage` holders can already inspect via the OR in
    // `requireGearInspector`, so seeding a default grant would only
    // duplicate an authority they have.
    const rows = await getDb()
      .select({ roleId: schema.rolePermissions.roleId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.permissionId, "perm_gear_inspect"));
    expect(rows).toEqual([]);
  });
});

describe("notice:manage", () => {
  it("is registered under its id, and not anonymous-grantable", async () => {
    const rows = await getDb()
      .select({
        name: schema.permissions.name,
        grantable: schema.permissions.anonymousGrantable,
      })
      .from(schema.permissions)
      .where(eq(schema.permissions.id, "perm_notice_manage"));
    expect(rows).toEqual([{ name: "notice:manage", grantable: false }]);
  });

  it("seeds no grants — system_admin holds it via the bypass", async () => {
    const rows = await getDb()
      .select({ roleId: schema.rolePermissions.roleId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.permissionId, "perm_notice_manage"));
    expect(rows).toEqual([]);
  });
});

/**
 * Pins migration 0083's list of permissions the `anonymous` role may
 * hold. Every signed-in viewer inherits those grants (#300), so growing
 * this set makes a permission public to the whole site: a change here
 * should be a deliberate migration, not a side effect.
 */
describe("anonymous-grantable permissions", () => {
  it("are exactly the public page views and history:view", async () => {
    const rows = await getDb()
      .select({ name: schema.permissions.name })
      .from(schema.permissions)
      .where(eq(schema.permissions.anonymousGrantable, true))
      .orderBy(asc(schema.permissions.name));

    expect(rows.map((r) => r.name)).toEqual([
      "history:view",
      "public_album:view",
      "public_calendar:view",
      "public_gazette:view",
      "public_gear_cave:view",
      "public_policies:view",
      "public_resources:view",
      "public_scholarships:view",
      "public_sponsors:view",
      "public_volunteer:view",
    ]);
  });

  it("leaves every seeded anonymous grant inside that set", async () => {
    const rows = await getDb()
      .select({
        name: schema.permissions.name,
        grantable: schema.permissions.anonymousGrantable,
      })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(eq(schema.rolePermissions.roleId, "role_anonymous"));

    // Non-empty, or the check below passes vacuously.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.grantable)).toEqual([]);
  });
});

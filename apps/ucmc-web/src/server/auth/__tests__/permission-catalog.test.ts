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

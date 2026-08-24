import { describe, expect, it } from "vitest";

import { withLegacyPermissionAliases } from "#/server/auth/permission-aliases";

/**
 * Temporary companion to the shim itself — delete both once migration
 * 0064 has been applied everywhere.
 */
describe("withLegacyPermissionAliases", () => {
  it("adds the current name when only the pre-0064 name is held", () => {
    const result = withLegacyPermissionAliases([
      "feedback:submit",
      "feedback:manage",
      "landing:edit",
    ]);

    expect(result).toContain("site_feedback:submit");
    expect(result).toContain("site_feedback:manage");
    expect(result).toContain("landing:manage");
  });

  it("keeps the legacy names so a pre-0064 database still satisfies both", () => {
    // The old names are what a not-yet-migrated DB hands back; dropping
    // them here would break nothing today but would make the shim
    // lossy if any caller still asked for one.
    const result = withLegacyPermissionAliases(["feedback:submit"]);

    expect(result).toContain("feedback:submit");
  });

  it("does not invent a grant the holder never had", () => {
    const result = withLegacyPermissionAliases(["gear:read"]);

    expect(result).toEqual(["gear:read"]);
  });

  it("is a no-op once the database carries the renamed permissions", () => {
    const migrated = ["site_feedback:submit", "landing:manage"];

    expect(withLegacyPermissionAliases(migrated)).toEqual(migrated);
  });
});

import { describe, expect, it } from "vitest";

import {
  effectivePageFlags,
  PAGE_SETTING_KEYS,
  pageFlagKeyOf,
  pageParentOf,
  SETTINGS,
} from "#/server/settings/settings-registry";
import type { PageFlagKey } from "#/server/settings/settings-registry";

/**
 * `effectivePageFlags` is the single place the section → page cascade
 * happens. Everything that asks "is this page on?" — the sidebar, both tab
 * bars, every route guard — reads the map it produces, so a bug here is a
 * bug in all of them at once.
 */

const ALL_KEYS = PAGE_SETTING_KEYS.map(pageFlagKeyOf);

function allOn(): Record<PageFlagKey, boolean> {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, true])) as Record<
    PageFlagKey,
    boolean
  >;
}

describe("page flag hierarchy", () => {
  it("declares members as a section with the directory as a child", () => {
    // The arrangement the cascade exists for: `members` is a grouping node
    // with no page of its own, and the approved directory has its own key.
    expect(pageParentOf("members")).toBeNull();
    expect(pageParentOf("members_approved")).toBe("members");
  });

  it("never declares a parent that isn't itself a page key", () => {
    // `SettingMeta.parent` is a bare string (it can't reference a type
    // derived from SETTINGS), so this is the check that catches a typo.
    for (const key of ALL_KEYS) {
      const declared = SETTINGS[`pages.${key}` as never];
      expect(declared).toBeDefined();
      const parent = pageParentOf(key);
      if (parent !== null) {
        expect(ALL_KEYS).toContain(parent);
      }
    }
  });

  it("does not treat underscore-separated keys as nested", () => {
    // `pages.gear_cave` is the public /gear-cave page, NOT a child of
    // `pages.gear`. If anyone ever "simplifies" parentage to a string
    // split, switching off Gear would take down an unrelated public page.
    expect(pageParentOf("gear_cave")).toBeNull();
    expect(pageParentOf("gear_loans")).not.toBe("gear_cave");
  });
});

describe("effectivePageFlags", () => {
  it("leaves everything on when nothing is switched off", () => {
    const out = effectivePageFlags(allOn());
    expect(Object.values(out).every((v) => v === true)).toBe(true);
  });

  it("switches off every child when the section is off", () => {
    const raw = { ...allOn(), members: false };
    const out = effectivePageFlags(raw);

    for (const key of ALL_KEYS) {
      if (pageParentOf(key) === "members" || key === "members") {
        expect(out[key]).toBe(false);
      }
    }
  });

  it("leaves pages outside the section untouched", () => {
    const out = effectivePageFlags({ ...allOn(), members: false });
    // Sibling root pages must not be collateral damage.
    expect(out.gear).toBe(true);
    expect(out.album).toBe(true);
    expect(out.access).toBe(true);
  });

  it("keeps a child off when only the child is off", () => {
    const out = effectivePageFlags({ ...allOn(), members_pending: false });
    expect(out.members_pending).toBe(false);
    expect(out.members).toBe(true);
    expect(out.members_approved).toBe(true);
  });

  it("does not mutate the input", () => {
    // The caller's raw map is what /settings would display; cascading must
    // not reach back and overwrite it.
    const raw = { ...allOn(), members: false };
    effectivePageFlags(raw);
    expect(raw.members_pending).toBe(true);
  });

  it("returns a value for every registered page key", () => {
    // Consumers index this map directly, so a missing key would read as
    // `undefined` — falsy, i.e. a page silently 404ing.
    const out = effectivePageFlags(allOn());
    expect(Object.keys(out).sort()).toEqual([...ALL_KEYS].sort());
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  effectivePageFlags,
  getMeta,
  pageAncestorsOf,
  PAGE_SETTING_KEYS,
  pageFlagKeyOf,
  pageParentOf,
  SETTINGS,
} from "#/server/settings/settings-registry";
import type {
  PageFlagKey,
  PageSettingKey,
} from "#/server/settings/settings-registry";

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

describe("pageAncestorsOf", () => {
  // The tests below reach into the live registry metadata to fabricate a
  // cycle, so every one of them has to put it back.
  const patched: Array<{ key: PageSettingKey; parent: string | undefined }> =
    [];

  function setParent(key: PageSettingKey, parent: string | undefined) {
    const meta = getMeta(key) as { parent?: string };
    patched.push({ key, parent: meta.parent });
    meta.parent = parent;
  }

  afterEach(() => {
    while (patched.length > 0) {
      const entry = patched.pop()!;
      (getMeta(entry.key) as { parent?: string }).parent = entry.parent;
    }
  });

  it("returns the declared chain nearest-first", () => {
    expect(pageAncestorsOf("gear_loans_detail")).toEqual([
      "gear_loans",
      "gear",
    ]);
    expect(pageAncestorsOf("gear")).toEqual([]);
  });

  it("every chain in the real registry terminates and is acyclic", () => {
    for (const key of ALL_KEYS) {
      const chain = pageAncestorsOf(key);
      expect(new Set(chain).size).toBe(chain.length);
      expect(chain).not.toContain(key);
    }
  });

  it("terminates on a mis-declared cycle instead of hanging", () => {
    // `parent` is a bare string that `pageParentOf` validates only for
    // registry *membership*, so nothing stops a future edit from closing a
    // loop: here `gear` is pointed back at its own grandchild. This must
    // degrade to a wrong answer, never a hung request or a blown stack —
    // and the screen that would hang is `/settings`, the one place the bad
    // flag could be fixed.
    setParent("pages.gear", "gear_loans_detail");

    const chain = pageAncestorsOf("gear_loans_detail");
    expect(new Set(chain).size).toBe(chain.length);
    expect(chain).not.toContain("gear_loans_detail");
    expect(chain).toEqual(["gear_loans", "gear"]);

    // The consumer of the walk has to survive it too.
    expect(() => effectivePageFlags(allOn())).not.toThrow();
  });

  it("survives a self-referential parent", () => {
    setParent("pages.album", "album");
    expect(pageAncestorsOf("album")).toEqual([]);
    expect(effectivePageFlags(allOn()).album).toBe(true);
  });
});

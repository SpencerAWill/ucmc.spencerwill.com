import { describe, expect, it } from "vitest";

import {
  ANALYTICS_PAGE_ORDER,
  ANALYTICS_PAGES,
  ANALYTICS_VIEW_PERMISSION,
  canSeeAnalyticsPage,
  visibleAnalyticsPages,
} from "#/config/analytics-pages";
import type { AnalyticsPageKey } from "#/config/analytics-pages";
import { PAGE_SETTING_KEYS } from "#/server/settings/settings-registry";

/** Every flag on, which is also every flag's registry default. */
const ALL_ON: Record<string, boolean> = Object.fromEntries(
  ANALYTICS_PAGE_ORDER.map((key) => [ANALYTICS_PAGES[key].flag, true]),
);

/** A `has` predicate over a fixed grant list, as the real callers pass. */
const granting =
  (...permissions: string[]) =>
  (permission: string) =>
    permissions.includes(permission);

describe("the registry is total", () => {
  // The order list is a separate decision from the object literal, so
  // nothing but a test stops the two from disagreeing — and a page
  // missing from the order is a page that silently never renders.
  it("orders exactly the pages that exist, with no duplicates", () => {
    expect([...ANALYTICS_PAGE_ORDER].sort()).toEqual(
      Object.keys(ANALYTICS_PAGES).sort(),
    );
    expect(new Set(ANALYTICS_PAGE_ORDER).size).toBe(
      ANALYTICS_PAGE_ORDER.length,
    );
  });

  // The whole permission model collapses to "analytics:view opens
  // everything" if a page ever ships with an empty list, and it would
  // do so silently: `.some()` on `[]` is false, so the page would just
  // vanish from every nav rather than failing loudly.
  it("gives every page at least one data permission", () => {
    for (const key of ANALYTICS_PAGE_ORDER) {
      expect(ANALYTICS_PAGES[key].dataPermissions.length).toBeGreaterThan(0);
    }
  });

  // The real drift risk: this registry names its kill switch as a bare
  // string (`src/config/` cannot import `PageFlagKey` without depending
  // on `src/server/`), so a typo here is a page that can never be
  // switched off rather than a type error.
  it("names a flag that exists in the settings registry", () => {
    for (const key of ANALYTICS_PAGE_ORDER) {
      expect(PAGE_SETTING_KEYS).toContain(`pages.${ANALYTICS_PAGES[key].flag}`);
    }
  });

  it("routes every page under /analytics", () => {
    for (const key of ANALYTICS_PAGE_ORDER) {
      expect(ANALYTICS_PAGES[key].path).toBe(`/analytics/${key}`);
    }
  });
});

describe("canSeeAnalyticsPage", () => {
  const gearViewer = granting(ANALYTICS_VIEW_PERMISSION, "gear:read");

  it("needs analytics:view as well as the data permission", () => {
    expect(canSeeAnalyticsPage(granting("gear:read"), "gear")).toBe(false);
    expect(canSeeAnalyticsPage(gearViewer, "gear")).toBe(true);
  });

  it("needs the data permission as well as analytics:view", () => {
    expect(
      canSeeAnalyticsPage(granting(ANALYTICS_VIEW_PERMISSION), "gear"),
    ).toBe(false);
  });

  // This is the point of the two-permission model: opening the area
  // must not hand over every panel in it.
  it("does not let one page's permission open another", () => {
    expect(canSeeAnalyticsPage(gearViewer, "compliance")).toBe(false);
    expect(canSeeAnalyticsPage(gearViewer, "membership")).toBe(false);
  });

  it("accepts any one of the alternatives, not all of them", () => {
    for (const permission of ANALYTICS_PAGES.gear.dataPermissions) {
      expect(
        canSeeAnalyticsPage(
          granting(ANALYTICS_VIEW_PERMISSION, permission),
          "gear",
        ),
      ).toBe(true);
    }
  });
});

describe("visibleAnalyticsPages", () => {
  const everything = granting(
    ANALYTICS_VIEW_PERMISSION,
    ...ANALYTICS_PAGE_ORDER.flatMap(
      (key) => ANALYTICS_PAGES[key].dataPermissions,
    ),
  );

  it("returns every page in registry order for a fully-granted viewer", () => {
    expect(visibleAnalyticsPages(everything, ALL_ON)).toEqual([
      ...ANALYTICS_PAGE_ORDER,
    ]);
  });

  it("drops a page whose flag is off even when permitted", () => {
    const flags = { ...ALL_ON, [ANALYTICS_PAGES.gear.flag]: false };
    expect(visibleAnalyticsPages(everything, flags)).not.toContain("gear");
  });

  // An absent key reads as `undefined`, and the filter has to treat
  // that as off rather than letting it through — the map is built from
  // the settings registry, so a key missing from it means the flag was
  // never registered.
  it("treats an absent flag as off", () => {
    expect(visibleAnalyticsPages(everything, {})).toEqual([]);
  });

  it("returns nothing for a viewer holding only analytics:view", () => {
    expect(
      visibleAnalyticsPages(granting(ANALYTICS_VIEW_PERMISSION), ALL_ON),
    ).toEqual([]);
  });

  it("returns only the pages a single-permission viewer may open", () => {
    const treasurerish = granting(ANALYTICS_VIEW_PERMISSION, "gear:manage");
    expect(visibleAnalyticsPages(treasurerish, ALL_ON)).toEqual([
      "gear",
    ] satisfies AnalyticsPageKey[]);
  });
});

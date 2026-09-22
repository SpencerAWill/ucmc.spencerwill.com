import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountTabsBar,
  activeAccountTabFromPath,
} from "#/components/layouts/account-tabs-bar";

// Same stubbing shape as `feedback-tabs-bar.test.tsx`: the bar reads
// `useLocation()` and the public-flags snapshot, so both are mocked and
// `Link` becomes a plain `<a>` so accessible-name queries work without a
// router. No auth stub — these tabs gate on page flags only.
const useLocationMock = vi.hoisted(() => vi.fn());
const flagsMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: flagsMock() }),
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicFlagsQueryOptions: () => ({
    queryKey: ["public-flags"],
    placeholderData: { pages: {} },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useLocation: useLocationMock,
}));

const ALL_TABS_ON = {
  my_profile: true,
  my_details: true,
  my_contacts: true,
  my_waiver: true,
  my_security: true,
  my_preferences: true,
} as const;

function setPathname(pathname: string) {
  useLocationMock.mockImplementation(
    ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname }),
  );
}

/**
 * Give every element fixed layout geometry for the duration of a test,
 * and spy on `scrollIntoView`.
 *
 * On the prototype rather than on the elements because the effect under
 * test runs on mount — by the time `render` returns, it has already read
 * whatever the geometry was. `using` restores the prototype on scope
 * exit; leaving these installed would silently change layout-dependent
 * behaviour in every test that follows in this file.
 */
function stubLayout(geometry: {
  clientWidth: number;
  offsetLeft: number;
  offsetWidth: number;
}) {
  const scrollIntoView = vi.fn();
  const saved = Object.fromEntries(
    (
      ["clientWidth", "offsetLeft", "offsetWidth", "scrollIntoView"] as const
    ).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  );

  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { value: geometry.clientWidth, configurable: true },
    offsetLeft: { value: geometry.offsetLeft, configurable: true },
    offsetWidth: { value: geometry.offsetWidth, configurable: true },
    scrollIntoView: { value: scrollIntoView, configurable: true },
  });

  return {
    scrollIntoView,
    [Symbol.dispose]() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, key, descriptor);
        } else {
          delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
            key
          ];
        }
      }
    },
  };
}

function setPageFlags(pages: Record<string, boolean>) {
  flagsMock.mockReturnValue({ pages });
}

describe("AccountTabsBar", () => {
  beforeEach(() => {
    useLocationMock.mockReset();
    flagsMock.mockReset();
    setPageFlags({ ...ALL_TABS_ON });
    setPathname("/my/profile");
  });

  it("renders every enabled tab in order", () => {
    render(<AccountTabsBar />);

    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Profile",
      "Details",
      "Contacts",
      "Waiver",
      "Security",
      "Preferences",
    ]);
  });

  it("hides a tab whose page flag is switched off", () => {
    setPageFlags({ ...ALL_TABS_ON, my_waiver: false });

    render(<AccountTabsBar />);

    expect(screen.queryByRole("link", { name: "Waiver" })).toBeNull();
  });

  it("marks only the current page with aria-current", () => {
    setPathname("/my/security");

    render(<AccountTabsBar />);

    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Profile", "Details", "Contacts", "Waiver"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  // Both of these pin a *mobile* defect that only reproduces on a
  // touch device, so a rendered assertion on the class list is the only
  // regression guard available in this pool. `e2e/mobile-overflow.spec.ts`
  // covers the observable half.
  it("mirrors PageContainer's responsive gutter in its bleed and its padding", () => {
    // The bar is the one element on `/my` that reaches outside the
    // gutter, and it has to reach out by exactly what the container
    // reached in: `px-4 sm:px-6`. A flat `-mx-6`/`px-6` (what shipped)
    // overhangs a `px-4` container by 8px per side, widening the
    // document and letting the whole page side-scroll on a phone.
    render(<AccountTabsBar />);

    const nav = screen.getByRole("navigation", { name: "Account sections" });
    const bleed = nav.parentElement;

    expect(bleed?.className).toMatch(/(^| )-mx-4( |$)/);
    expect(bleed?.className).toMatch(/(^| )sm:-mx-6( |$)/);
    expect(nav.className).toMatch(/(^| )px-4( |$)/);
    expect(nav.className).toMatch(/(^| )sm:px-6( |$)/);
    // A flat -mx-6 is the specific regression: it must not come back.
    expect(bleed?.className).not.toMatch(/(^| )-mx-6( |$)/);
  });

  it("scrolls horizontally only, and claims only horizontal pans", () => {
    // `overflow-x-auto` alone is not enough. Per CSS Overflow 3, a
    // non-`visible` value on one axis computes the other axis'
    // `visible` to `auto` — so the row was vertically scrollable too and
    // a touch-drag slid the labels around inside their own 40px box.
    render(<AccountTabsBar />);

    const nav = screen.getByRole("navigation", { name: "Account sections" });

    expect(nav.className).toMatch(/(^| )overflow-x-auto( |$)/);
    expect(nav.className).toMatch(/(^| )overflow-y-hidden( |$)/);
    expect(nav.className).toMatch(/(^| )touch-pan-x( |$)/);
  });

  it("scrolls the active tab into view without scrolling the document", () => {
    // Six tabs don't fit a phone and the row starts at scrollLeft 0, so
    // landing on a late tab showed the current tab clipped or off
    // screen — the highlight missing from the one surface whose job is
    // saying where you are.
    //
    // jsdom does no layout, so the geometry is stubbed on the prototype
    // (the effect runs on mount, before a per-element stub could be
    // installed). Two things are pinned: the row's own `scrollLeft` is
    // what moves, and `scrollIntoView` is *not* how — it walks every
    // scrollable ancestor, so it would also scroll the document and
    // jump the page past the greeting.
    setPathname("/my/preferences");
    using geometry = stubLayout({
      clientWidth: 390,
      offsetLeft: 500,
      offsetWidth: 100,
    });

    render(<AccountTabsBar />);

    const nav = screen.getByRole("navigation", { name: "Account sections" });
    // 500 - (390 - 100) / 2 — the tab centred in the row.
    expect(nav.scrollLeft).toBe(355);
    expect(geometry.scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the row at its left edge when the first tab is active", () => {
    // The clamp at 0 is the reason this is separate: centring the first
    // tab would compute a negative offset and pull it away from the left
    // edge, where the row already reads correctly.
    setPathname("/my/profile");
    using _geometry = stubLayout({
      clientWidth: 390,
      offsetLeft: 0,
      offsetWidth: 100,
    });

    render(<AccountTabsBar />);

    expect(
      screen.getByRole("navigation", { name: "Account sections" }).scrollLeft,
    ).toBe(0);
  });

  it("spotlights the current tab visually, not just via aria-current", () => {
    // The highlight is the point of the bar: a keyboard/AT-only signal
    // would leave a sighted member unable to see where they are.
    setPathname("/my/contacts");

    render(<AccountTabsBar />);

    const active = screen.getByRole("link", { name: "Contacts" });
    const inactive = screen.getByRole("link", { name: "Profile" });

    expect(active.className).toMatch(/border-primary/);
    expect(active.className).toMatch(/bg-muted\/70/);
    expect(inactive.className).toMatch(/border-transparent/);
    // `twMerge` has to settle the conflicting border colours, or the
    // underline depends on stylesheet order rather than on the route.
    expect(active.className).not.toMatch(/border-transparent/);
  });
});

describe("activeAccountTabFromPath", () => {
  it.each([
    ["/my/profile", "/my/profile"],
    ["/my/details", "/my/details"],
    ["/my/waiver", "/my/waiver"],
    // A future nested child still lights up its parent tab.
    ["/my/profile/edit", "/my/profile"],
  ] as const)("maps %s to %s", (pathname, expected) => {
    expect(activeAccountTabFromPath(pathname)).toBe(expected);
  });

  it.each([
    // `/my` redirects to `/my/profile`, so nothing is active in passing,
    // and the sibling `/my/gear` routes opt out of this chrome entirely.
    "/my",
    "/my/gear",
    "/my/gear/cart",
  ])("leaves %s with no active tab", (pathname) => {
    expect(activeAccountTabFromPath(pathname)).toBeUndefined();
  });
});

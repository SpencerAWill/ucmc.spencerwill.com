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

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarNav } from "#/components/layouts/app-layout";
import { SidebarProvider } from "#/components/ui/sidebar";
import { authStub } from "#/test-support/auth-stub";

// The nav's own logic is the subject; its heavy children (the bell, the
// user menu) are stubbed so this doesn't drag in the announcements and
// auth feature graphs. `Link` becomes a plain `<a>` so accessible-name
// queries work without a router.
const useAuthMock = vi.hoisted(() => vi.fn());
const flagsMock = vi.hoisted(() => vi.fn());

vi.mock("#/features/auth/api/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("#/features/announcements/components/announcements-bell", () => ({
  AnnouncementsBell: () => null,
}));
vi.mock("#/features/auth/components/user-menu", () => ({
  UserMenu: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[]; placeholderData?: unknown }) =>
    options.queryKey[0] === "public-flags"
      ? { data: flagsMock() }
      : { data: options.placeholderData },
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicFlagsQueryOptions: () => ({
    queryKey: ["public-flags"],
    placeholderData: { pages: {}, announcements: false },
  }),
  publicSiteContactQueryOptions: () => ({
    queryKey: ["public-site-contact"],
    placeholderData: {},
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
  useLocation: ({
    select,
  }: {
    select: (loc: { pathname: string }) => unknown;
  }) => select({ pathname: "/" }),
}));

/**
 * Effective flags: the cascade has already been applied by the time the
 * snapshot reaches the client, so a section being on says nothing about
 * its children — and a section being OFF means every child is already
 * false here. Tests that switch a section off must zero its children too,
 * exactly as `effectivePageFlags` would.
 */
const PAGES_ON = {
  members: true,
  members_approved: true,
  members_waivers: true,
  gear: true,
  gear_inventory: true,
  gear_loans: true,
} as const;

function setFlags(pages: Record<string, boolean>) {
  flagsMock.mockReturnValue({ pages, announcements: false });
}

function setAuth(permissions: string[], isApproved = true) {
  useAuthMock.mockReturnValue(authStub(permissions, { isApproved }));
}

function renderNav() {
  return render(
    <SidebarProvider>
      <SidebarNav />
    </SidebarProvider>,
  );
}

const OFFICER = ["gear:read", "gear:loan", "waivers:verify"];

describe("SidebarNav page-flag gates", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    flagsMock.mockReset();
    setFlags({ ...PAGES_ON });
    setAuth(OFFICER);
  });

  it("shows the Waivers entry for waivers:view alone, not just waivers:verify", () => {
    // The read tier (migration 0064) reaches the queue read-only; the
    // attest controls on the page gate separately. If the nav kept
    // gating on `waivers:verify`, a view-only exec would have no way
    // to navigate to the page they're authorized to read.
    setAuth(["waivers:view"]);

    renderNav();

    expect(screen.getByRole("link", { name: "Waivers" })).toHaveAttribute(
      "href",
      "/members/waivers",
    );
  });

  it("hides the Waivers entry when the viewer holds neither waiver permission", () => {
    setAuth(["gear:read"]);

    renderNav();

    expect(screen.queryByRole("link", { name: "Waivers" })).toBeNull();
  });

  it("links Members and Gear when their index pages are on", () => {
    renderNav();

    expect(screen.getByRole("link", { name: /Members/ })).toHaveAttribute(
      "href",
      "/members",
    );
    expect(screen.getByRole("link", { name: /^Gear$/ })).toHaveAttribute(
      "href",
      "/gear",
    );
  });

  it.each([
    ["members_approved", /Members/, "Waivers"],
    ["gear_inventory", /^Gear$/, "Loans"],
  ])(
    "renders an inert header, not a link, when %s is off",
    (flag, label, subItem) => {
      // The bug this pins: these entries were gated on the SECTION switch
      // (`pages.members` / `pages.gear`) while linking to `/members` and
      // `/gear`, which are gated by the index-page flags. Switching off
      // just the index page left a live sidebar link to a route that
      // throws notFound() — and made the documented inert-group-header
      // fallback unreachable.
      setFlags({ ...PAGES_ON, [flag]: false });

      renderNav();

      expect(screen.queryByRole("link", { name: label })).toBeNull();
      // The label survives as a group header so the sub-item stays reachable.
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: subItem })).toBeInTheDocument();
    },
  );

  it.each([
    ["members", ["members_approved", "members_waivers"], /Members/],
    ["gear", ["gear_inventory", "gear_loans"], /^Gear$/],
  ])(
    "drops the entry entirely when the %s section is off",
    (section, children, label) => {
      // Effective flags zero the children when the section goes off, so
      // nothing is left to render — not even the inert header.
      const pages: Record<string, boolean> = { ...PAGES_ON, [section]: false };
      for (const child of children) {
        pages[child] = false;
      }
      setFlags(pages);

      renderNav();

      expect(screen.queryByText(label)).toBeNull();
    },
  );
});

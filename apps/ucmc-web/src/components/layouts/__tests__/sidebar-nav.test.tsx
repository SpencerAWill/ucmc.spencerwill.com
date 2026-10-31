import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarNav, SidebarUtilityNav } from "#/components/layouts/app-layout";
import { SidebarProvider } from "#/components/ui/sidebar";
import { authStub } from "#/test-support/auth-stub";

// The nav's own logic is the subject; its heavy children (the user menu)
// are stubbed so this doesn't drag in the auth feature graph. `Link`
// becomes a plain `<a>` so accessible-name queries work without a router.
const useAuthMock = vi.hoisted(() => vi.fn());
const flagsMock = vi.hoisted(() => vi.fn());

vi.mock("#/features/auth/api/use-auth", () => ({ useAuth: useAuthMock }));
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
    placeholderData: { pages: {} },
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
  trip_signup: true,
  sponsors: true,
} as const;

function setFlags(pages: Record<string, boolean>) {
  flagsMock.mockReturnValue({ pages });
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

  it("links Trip sign-up to /trip-sign-up", () => {
    // `/trips` is reserved for the real feature and only redirects; the
    // entry must point at the stopgap's own URL.
    renderNav();

    expect(screen.getByRole("link", { name: "Trip sign-up" })).toHaveAttribute(
      "href",
      "/trip-sign-up",
    );
  });

  it("hides Trip sign-up when the page flag is off", () => {
    setFlags({ ...PAGES_ON, trip_signup: false });

    renderNav();

    expect(screen.queryByText("Trip sign-up")).toBeNull();
  });

  it("shows Trip sign-up to a signed-out visitor", () => {
    // The form is public, so the entry sits in the public group with no
    // permission or approval gate — only its page flag.
    setAuth([], false);

    renderNav();

    expect(
      screen.getByRole("link", { name: "Trip sign-up" }),
    ).toBeInTheDocument();
  });

  it("links Sponsors for a viewer holding public_sponsors:view", () => {
    // /sponsors is anonymous-visible by seed, so the nav entry has to
    // appear for a viewer whose only sponsor grant is `:view` — the
    // manage and perks permissions gate what's *on* the page, not
    // whether it can be navigated to.
    setAuth(["public_sponsors:view"]);

    renderNav();

    expect(screen.getByRole("link", { name: "Sponsors" })).toHaveAttribute(
      "href",
      "/sponsors",
    );
  });

  it("hides Sponsors when the page flag is off", () => {
    setFlags({ ...PAGES_ON, sponsors: false });
    setAuth(["public_sponsors:view"]);

    renderNav();

    expect(screen.queryByText("Sponsors")).toBeNull();
  });

  it("hides Sponsors when the viewer lacks public_sponsors:view", () => {
    // Revoking the role_anonymous grant takes the page private; the nav
    // entry has to follow, or signed-out visitors get a link to a
    // notFound.
    setAuth(["gear:read"]);

    renderNav();

    expect(screen.queryByText("Sponsors")).toBeNull();
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

describe("SidebarUtilityNav Feedback entry", () => {
  const FEEDBACK_ON = {
    feedback: true,
    feedback_site: true,
    feedback_club: true,
  };

  function renderUtility() {
    return render(
      <SidebarProvider>
        <SidebarUtilityNav />
      </SidebarProvider>,
    );
  }

  beforeEach(() => {
    useAuthMock.mockReset();
    flagsMock.mockReset();
    setFlags({ ...FEEDBACK_ON });
  });

  it("shows Feedback only to a manager of a reachable surface", () => {
    setAuth(["site_feedback:manage"]);
    renderUtility();
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "href",
      "/feedback",
    );
  });

  it("hides Feedback from a member who can only submit", () => {
    setAuth(["site_feedback:submit", "club_feedback:submit"]);
    renderUtility();
    expect(screen.queryByRole("link", { name: "Feedback" })).toBeNull();
  });

  it("hides Feedback when the managed surface's page is off", () => {
    setFlags({ ...FEEDBACK_ON, feedback_site: false });
    setAuth(["site_feedback:manage"]);
    renderUtility();
    expect(screen.queryByRole("link", { name: "Feedback" })).toBeNull();
  });
});

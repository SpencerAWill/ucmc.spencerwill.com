import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETENTION_DEACTIVATED_COPY,
  RETENTION_REJECTED_COPY,
} from "#/config/legal";
import {
  MembersTabsBar,
  activeMembersTabFromPath,
  getMembersTabSubtitle,
} from "#/features/members/components/members-tabs-bar";
import { authStub } from "#/test-support/auth-stub";

// The bar reads `useAuth().hasPermission` and `useLocation()` from the
// router plus the public-flags snapshot via `useQuery`; we stub all three
// so the test stays focused on the gate behavior. Replacing `Link` with a
// plain `<a>` lets accessible-name queries find the tabs without spinning
// up a router or context.
const useAuthMock = vi.hoisted(() => vi.fn());
const useLocationMock = vi.hoisted(() => vi.fn());
const flagsMock = vi.hoisted(() => vi.fn());

vi.mock("#/features/auth/api/use-auth", () => ({
  useAuth: useAuthMock,
}));

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

function setAuth(canManage: boolean) {
  useAuthMock.mockReturnValue(authStub(canManage ? ["members:manage"] : []));
}

function setPathname(pathname: string) {
  useLocationMock.mockImplementation(
    ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname }),
  );
}

// `members` is the SECTION switch; `members_approved` is the Approved
// directory tab. They used to be one key, which is why the Approved tab
// reads `members_approved` here and not `members`.
const ALL_MEMBER_PAGES_ON = {
  members: true,
  members_approved: true,
  members_pending: true,
  members_unclaimed: true,
  members_rejected: true,
  members_deactivated: true,
} as const;

function setPageFlags(pages: Record<string, boolean>) {
  flagsMock.mockReturnValue({ pages });
}

describe("MembersTabsBar", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useLocationMock.mockReset();
    flagsMock.mockReset();
    setPageFlags({ ...ALL_MEMBER_PAGES_ON });
  });

  it("renders nothing when the caller lacks members:manage", () => {
    setAuth(false);
    setPathname("/members");

    const { container } = render(<MembersTabsBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders all five tabs for officers", () => {
    setAuth(true);
    setPathname("/members");

    render(<MembersTabsBar />);

    for (const label of [
      "Approved",
      "Pending",
      "Unclaimed",
      "Rejected",
      "Deactivated",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("hides the Approved tab via members_approved, not the section switch", () => {
    // Regression guard for the rename: the tab bar must key the Approved
    // tab off the directory's own flag. Reading the section key here would
    // make "hide the directory" and "take down the whole area" the same
    // control again — the bug the split was introduced to fix.
    setAuth(true);
    setPathname("/members");
    setPageFlags({ ...ALL_MEMBER_PAGES_ON, members_approved: false });

    render(<MembersTabsBar />);

    expect(screen.queryByRole("link", { name: "Approved" })).toBeNull();
    // The officer queues are unaffected.
    expect(screen.getByRole("link", { name: "Pending" })).toBeInTheDocument();
  });

  it("hides a tab whose page kill switch is off", () => {
    setAuth(true);
    setPathname("/members");
    setPageFlags({ ...ALL_MEMBER_PAGES_ON, members_rejected: false });

    render(<MembersTabsBar />);

    expect(screen.queryByRole("link", { name: "Rejected" })).toBeNull();
    // The others remain.
    expect(screen.getByRole("link", { name: "Pending" })).toBeInTheDocument();
  });

  // Active-tab styling rides on the Button `variant`; shadcn `secondary`
  // adds the `bg-secondary` class while `ghost` doesn't. Inspect the
  // anchor itself — Button `asChild` collapses into the child, so there
  // is no wrapping <button>.
  it.each<[string, string]>([
    ["/members", "Approved"],
    ["/members/pending", "Pending"],
    ["/members/unclaimed", "Unclaimed"],
    ["/members/rejected", "Rejected"],
    ["/members/deactivated", "Deactivated"],
  ])("marks the active tab on %s", (pathname, activeLabel) => {
    setAuth(true);
    setPathname(pathname);

    render(<MembersTabsBar />);

    const active = screen.getByRole("link", { name: activeLabel });
    expect(active.className).toMatch(/bg-secondary/);

    // And every other tab is *not* marked active.
    const otherLabels = [
      "Approved",
      "Pending",
      "Unclaimed",
      "Rejected",
      "Deactivated",
    ].filter((l) => l !== activeLabel);
    for (const label of otherLabels) {
      const link = screen.getByRole("link", { name: label });
      expect(link.className).not.toMatch(/bg-secondary/);
    }
  });
});

describe("activeMembersTabFromPath", () => {
  it.each([
    ["/members", "approved"],
    ["/members/", "approved"],
    ["/members/some-publicId", "approved"],
    ["/members/pending", "pending"],
    ["/members/pending/", "pending"],
    ["/members/unclaimed", "unclaimed"],
    ["/members/rejected", "rejected"],
    ["/members/deactivated", "deactivated"],
  ] as const)("maps %s to %s", (pathname, expected) => {
    expect(activeMembersTabFromPath(pathname)).toBe(expected);
  });
});

describe("getMembersTabSubtitle", () => {
  it("returns the directory copy for the approved tab", () => {
    expect(getMembersTabSubtitle("/members")).toMatch(/approved club members/i);
  });

  it("returns the rejected copy with retention text", () => {
    expect(getMembersTabSubtitle("/members/rejected")).toContain(
      RETENTION_REJECTED_COPY,
    );
  });

  it("returns the deactivated copy with retention text", () => {
    expect(getMembersTabSubtitle("/members/deactivated")).toContain(
      RETENTION_DEACTIVATED_COPY,
    );
  });
});

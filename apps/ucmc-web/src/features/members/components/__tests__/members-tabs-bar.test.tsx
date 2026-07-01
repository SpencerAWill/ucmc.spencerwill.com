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

// The bar reads `useAuth().hasPermission` and `useLocation()` from the
// router; we stub both so the test stays focused on the gate behavior.
// Replacing `Link` with a plain `<a>` lets accessible-name queries find
// the tabs without spinning up a router or context.
const useAuthMock = vi.hoisted(() => vi.fn());
const useLocationMock = vi.hoisted(() => vi.fn());

vi.mock("#/features/auth/api/use-auth", () => ({
  useAuth: useAuthMock,
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
  useAuthMock.mockReturnValue({
    hasPermission: (name: string) => canManage && name === "members:manage",
  });
}

function setPathname(pathname: string) {
  useLocationMock.mockImplementation(
    ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname }),
  );
}

describe("MembersTabsBar", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useLocationMock.mockReset();
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

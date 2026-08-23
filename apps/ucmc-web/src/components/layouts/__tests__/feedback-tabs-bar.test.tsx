import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeedbackTabsBar,
  activeFeedbackTabFromPath,
  getFeedbackTabSubtitle,
} from "#/components/layouts/feedback-tabs-bar";

// Same stubbing shape as `members-tabs-bar.test.tsx`: the bar reads
// `useAuth().hasPermission`, `useLocation()`, and the public-flags
// snapshot, so all three are mocked and `Link` becomes a plain `<a>` so
// accessible-name queries work without a router.
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

const BOTH_SURFACES_ON = { feedback_site: true, feedback_club: true } as const;

function setPermissions(names: string[]) {
  useAuthMock.mockReturnValue({
    hasPermission: (name: string) => names.includes(name),
  });
}

function setPathname(pathname: string) {
  useLocationMock.mockImplementation(
    ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname }),
  );
}

function setPageFlags(pages: Record<string, boolean>) {
  flagsMock.mockReturnValue({ pages });
}

const BOTH_PERMISSIONS = ["feedback:submit", "club_feedback:submit"];

describe("FeedbackTabsBar", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useLocationMock.mockReset();
    flagsMock.mockReset();
    setPageFlags({ ...BOTH_SURFACES_ON });
    setPathname("/feedback/club");
  });

  it("renders both tabs, club first, for a viewer holding both", () => {
    setPermissions(BOTH_PERMISSIONS);

    render(<FeedbackTabsBar />);

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Club", "Site"]);
  });

  it("renders nothing when the viewer can only reach one surface", () => {
    // A one-option switcher is just noise.
    setPermissions(["club_feedback:submit"]);

    const { container } = render(<FeedbackTabsBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["feedback_site", "Site"],
    ["feedback_club", "Club"],
  ])(
    "hides the whole bar when %s is switched off, rather than linking to a 404",
    (flag) => {
      // Regression guard: the bar composes `permission && flags.pages.<key>`
      // like every other nav surface. It read permissions ONLY when the
      // page flags landed, so an officer holding both permissions kept a
      // tab pointing at a switched-off surface whose route throws notFound.
      setPermissions(BOTH_PERMISSIONS);
      setPageFlags({ ...BOTH_SURFACES_ON, [flag]: false });

      const { container } = render(<FeedbackTabsBar />);

      // Only one surface is reachable, so the switcher collapses entirely.
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("marks the active surface with aria-current", () => {
    setPermissions(BOTH_PERMISSIONS);
    setPathname("/feedback/site");

    render(<FeedbackTabsBar />);

    expect(screen.getByRole("link", { name: "Site" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Club" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("activeFeedbackTabFromPath", () => {
  it.each([
    ["/feedback/club", "club"],
    ["/feedback/club/", "club"],
    ["/feedback/site", "site"],
    ["/feedback/site/", "site"],
    // `/feedback` itself redirects; club is the documented fallback.
    ["/feedback", "club"],
  ] as const)("maps %s to %s", (pathname, expected) => {
    expect(activeFeedbackTabFromPath(pathname)).toBe(expected);
  });
});

describe("getFeedbackTabSubtitle", () => {
  it("names the exec board for the club surface", () => {
    expect(getFeedbackTabSubtitle("/feedback/club")).toMatch(/exec board/i);
  });

  it("describes site maintenance for the site surface", () => {
    expect(getFeedbackTabSubtitle("/feedback/site")).toMatch(/bug/i);
  });
});

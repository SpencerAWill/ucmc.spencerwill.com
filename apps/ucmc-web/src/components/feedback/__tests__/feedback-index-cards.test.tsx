import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FeedbackIndexCards } from "#/components/feedback/feedback-index-cards";
import type { FeedbackIndexCardsProps } from "#/components/feedback/feedback-index-cards";

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
}));

const base: FeedbackIndexCardsProps = {
  clubReachable: true,
  siteReachable: true,
  canManageClub: false,
  canManageSite: false,
  club: { mineOpen: 1, newForOfficers: null },
  site: { mineOpen: 2, mineTracked: 1, untriaged: null },
};

function headings(): string[] {
  return screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
}

describe("FeedbackIndexCards", () => {
  it("renders club then site for a viewer who can reach both", () => {
    render(<FeedbackIndexCards {...base} />);
    expect(headings()).toEqual(["Club feedback", "Site feedback"]);
    expect(
      screen.getByRole("link", { name: "Give club feedback" }),
    ).toHaveAttribute("href", "/feedback/club");
    expect(
      screen.getByRole("link", { name: "Report a site issue" }),
    ).toHaveAttribute("href", "/feedback/site");
  });

  it("renders only the site card when club is unreachable", () => {
    render(<FeedbackIndexCards {...base} clubReachable={false} />);
    expect(headings()).toEqual(["Site feedback"]);
  });

  it("shows member badges and omits zero counts", () => {
    render(
      <FeedbackIndexCards
        {...base}
        club={{ mineOpen: 0, newForOfficers: null }}
      />,
    );
    expect(screen.getByText("2 of yours open")).toBeInTheDocument();
    expect(screen.getByText("1 of yours tracked")).toBeInTheDocument();
    expect(screen.queryByText("0 of yours open")).toBeNull();
  });

  it("shows manager badges and the Review link when manage is granted", () => {
    render(
      <FeedbackIndexCards
        {...base}
        canManageClub
        canManageSite
        club={{ mineOpen: 0, newForOfficers: 3 }}
        site={{ mineOpen: 0, mineTracked: 0, untriaged: 4 }}
      />,
    );
    expect(screen.getByText("3 new for officers")).toBeInTheDocument();
    expect(screen.getByText("4 untriaged")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/feedback/club",
    );
  });

  it("hides manager affordances when manage is false even though the payload carries counts (role emulation)", () => {
    render(
      <FeedbackIndexCards
        {...base}
        canManageClub={false}
        canManageSite={false}
        club={{ mineOpen: 0, newForOfficers: 3 }}
        site={{ mineOpen: 0, mineTracked: 0, untriaged: 4 }}
      />,
    );
    expect(screen.queryByText("3 new for officers")).toBeNull();
    expect(screen.queryByText("4 untriaged")).toBeNull();
    expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
  });
});

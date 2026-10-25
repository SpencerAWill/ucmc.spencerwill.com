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
  club: { newForOfficers: null },
  site: { untriaged: null },
};

function headings(): string[] {
  return screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
}

/**
 * `/feedback` is the managers' area: each card is a way into a backlog,
 * so "reachable" already means manage plus the surface's page flag.
 */
describe("FeedbackIndexCards", () => {
  it("renders club then site for a manager of both", () => {
    render(<FeedbackIndexCards {...base} />);
    expect(headings()).toEqual(["Club feedback", "Site feedback"]);
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/feedback/club",
    );
    expect(screen.getByRole("link", { name: "Triage" })).toHaveAttribute(
      "href",
      "/feedback/site/triage",
    );
  });

  it("renders only the site card when club is unreachable", () => {
    render(<FeedbackIndexCards {...base} clubReachable={false} />);
    expect(headings()).toEqual(["Site feedback"]);
  });

  it("shows the manager counts and omits zero", () => {
    render(
      <FeedbackIndexCards
        {...base}
        club={{ newForOfficers: 0 }}
        site={{ untriaged: 4 }}
      />,
    );
    expect(screen.getByText("4 untriaged")).toBeInTheDocument();
    expect(screen.queryByText("0 new for officers")).toBeNull();
  });

  it('shows no "of yours" badges', () => {
    render(
      <FeedbackIndexCards
        {...base}
        club={{ newForOfficers: 3 }}
        site={{ untriaged: 4 }}
      />,
    );
    expect(screen.getByText("3 new for officers")).toBeInTheDocument();
    expect(screen.queryByText(/of yours/)).toBeNull();
  });
});

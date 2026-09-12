import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UpcomingOutings } from "#/features/volunteer/components/upcoming-outings";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

function outing(
  overrides: Partial<VolunteerEventEntry> = {},
): VolunteerEventEntry {
  return {
    id: "vevt_1",
    publicId: "abcdefghijkl",
    title: "Trail day",
    partnerOrg: null,
    location: null,
    startsAtMs: at("2026-10-03T13:00:00Z"),
    endsAtMs: null,
    description: null,
    signupUrl: null,
    volunteersCount: null,
    serviceHours: null,
    albumTag: null,
    ...overrides,
  };
}

describe("<UpcomingOutings />", () => {
  it("says so when nothing is scheduled", () => {
    render(<UpcomingOutings outings={[]} />);
    expect(screen.getByText(/nothing on the calendar/i)).toBeInTheDocument();
  });

  it("renders a same-day finish as a time range, not a second date", () => {
    render(
      <UpcomingOutings
        outings={[
          outing({
            startsAtMs: at("2026-10-03T13:00:00Z"),
            endsAtMs: at("2026-10-03T17:00:00Z"),
          }),
        ]}
      />,
    );
    // The end time must appear somewhere — it's collected and validated,
    // so dropping it silently loses what the officer typed.
    const when = screen.getByText(/–/);
    expect(when.textContent).toMatch(/–/);
    // One date, two clock times.
    expect(when.textContent.match(/2026/g)).toHaveLength(1);
  });

  it("keeps the full date on both sides of a multi-day outing", () => {
    render(
      <UpcomingOutings
        outings={[
          outing({
            startsAtMs: at("2026-10-03T13:00:00Z"),
            endsAtMs: at("2026-10-04T17:00:00Z"),
          }),
        ]}
      />,
    );
    const when = screen.getByText(/–/);
    expect(when.textContent.match(/2026/g)).toHaveLength(2);
  });

  it("shows only the start when no end time is on file", () => {
    render(<UpcomingOutings outings={[outing()]} />);
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });

  it("prefers the partner's form and marks it external", () => {
    render(
      <UpcomingOutings
        outings={[outing({ signupUrl: "https://partner.org/x" })]}
        clubEmail="club@example.com"
      />,
    );
    const link = screen.getByRole("link", { name: /join this one/i });
    expect(link).toHaveAttribute("href", "https://partner.org/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("never renders a javascript: sign-up link", () => {
    render(
      <UpcomingOutings
        outings={[outing({ signupUrl: "javascript:alert(1)" })]}
        clubEmail="club@example.com"
      />,
    );
    const link = screen.getByRole("link", { name: /join this one/i });
    expect(link.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("offers no join affordance with neither a link nor a club email", () => {
    render(<UpcomingOutings outings={[outing()]} />);
    expect(
      screen.queryByRole("link", { name: /join this one/i }),
    ).not.toBeInTheDocument();
  });
});

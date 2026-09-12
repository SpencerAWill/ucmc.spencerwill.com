import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ServiceRecord } from "#/features/volunteer/components/service-record";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, unknown>;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={
        search
          ? `${to}?${new URLSearchParams(
              Object.entries(search).map(([k, v]) => [k, String(v)]),
            ).toString()}`
          : to
      }
      {...rest}
    >
      {children}
    </a>
  ),
}));

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

function outing(
  overrides: Partial<VolunteerEventEntry> & { startsAtMs: number },
): VolunteerEventEntry {
  return {
    id: `vevt_${overrides.startsAtMs}`,
    publicId: "abcdefghijkl",
    title: "Outing",
    partnerOrg: null,
    location: null,
    endsAtMs: null,
    description: null,
    signupUrl: null,
    volunteersCount: null,
    serviceHours: null,
    albumTag: null,
    ...overrides,
  };
}

describe("<ServiceRecord />", () => {
  it("says so when the archive is empty", () => {
    render(<ServiceRecord outings={[]} />);
    expect(screen.getByText(/no past outings on record/i)).toBeInTheDocument();
  });

  it("leads with totals summed only over outings that recorded them", () => {
    render(
      <ServiceRecord
        outings={[
          outing({
            startsAtMs: at("2026-05-01T12:00:00Z"),
            volunteersCount: 12,
            serviceHours: 48,
          }),
          outing({
            startsAtMs: at("2026-03-01T12:00:00Z"),
            volunteersCount: 8,
          }),
          outing({ startsAtMs: at("2025-11-01T12:00:00Z") }),
        ]}
      />,
    );
    const volunteers = screen.getByText("Volunteers").closest("div");
    expect(
      within(volunteers as HTMLElement).getByText("20"),
    ).toBeInTheDocument();
    const hours = screen.getByText("Service hours").closest("div");
    expect(within(hours as HTMLElement).getByText("48")).toBeInTheDocument();
  });

  it("flags partial coverage so a total can't read as the whole story", () => {
    render(
      <ServiceRecord
        outings={[
          outing({
            startsAtMs: at("2026-05-01T12:00:00Z"),
            volunteersCount: 12,
            serviceHours: 48,
          }),
          outing({ startsAtMs: at("2026-03-01T12:00:00Z") }),
        ]}
      />,
    );
    expect(screen.getAllByText("recorded for 1 of 2")).toHaveLength(2);
  });

  it("omits the coverage note when every outing reported", () => {
    render(
      <ServiceRecord
        outings={[
          outing({
            startsAtMs: at("2026-05-01T12:00:00Z"),
            volunteersCount: 12,
            serviceHours: 48,
          }),
        ]}
      />,
    );
    expect(screen.queryByText(/recorded for/i)).not.toBeInTheDocument();
  });

  it("omits the coverage note when nothing reported, since the total is already 0", () => {
    render(
      <ServiceRecord
        outings={[outing({ startsAtMs: at("2026-05-01T12:00:00Z") })]}
      />,
    );
    expect(screen.queryByText(/recorded for/i)).not.toBeInTheDocument();
  });

  it("groups outings under their club year, newest first", () => {
    render(
      <ServiceRecord
        outings={[
          outing({ startsAtMs: at("2026-05-01T12:00:00Z"), title: "Spring" }),
          outing({ startsAtMs: at("2024-11-01T12:00:00Z"), title: "Autumn" }),
        ]}
      />,
    );
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["2025-26", "2024-25"]);
  });

  it("links an outing carrying an album tag to the filtered Album", () => {
    render(
      <ServiceRecord
        outings={[
          outing({
            startsAtMs: at("2026-05-01T12:00:00Z"),
            albumTag: "Trail Day 2026",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /photos/i })).toHaveAttribute(
      "href",
      "/album?tag=Trail+Day+2026",
    );
  });

  it("offers no photos link when the outing has no album tag", () => {
    render(
      <ServiceRecord
        outings={[outing({ startsAtMs: at("2026-05-01T12:00:00Z") })]}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /photos/i }),
    ).not.toBeInTheDocument();
  });

  it("shows manage affordances only when the caller says so", () => {
    const outings = [outing({ startsAtMs: at("2026-05-01T12:00:00Z") })];
    const { rerender } = render(<ServiceRecord outings={outings} />);
    expect(
      screen.queryByRole("button", { name: /^edit/i }),
    ).not.toBeInTheDocument();

    rerender(
      <ServiceRecord
        outings={outings}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^edit/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^delete/i }),
    ).toBeInTheDocument();
  });
});

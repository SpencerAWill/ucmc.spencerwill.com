import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SponsorGrid } from "#/features/sponsors/components/sponsor-grid";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";

// The read-only grid never mounts the sortable list, but the module
// imports the reorder hook at the top level, so the mutation hook needs a
// stub for the jsdom pool (no query client, no server fns).
vi.mock("#/features/sponsors/api/use-sponsor-mutations", () => ({
  useReorderSponsors: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("#/config/env", () => ({ env: { VITE_R2_PUBLIC_HOST: undefined } }));

function sponsor(overrides: Partial<SponsorEntry> = {}): SponsorEntry {
  return {
    id: "spon_1",
    publicId: "abc123",
    name: "Roads Rivers and Trails",
    websiteUrl: "https://example.com",
    blurb: "An outfitter that has kitted out UCMC trips for years.",
    logoKey: null,
    logoWidthPx: null,
    logoHeightPx: null,
    ...overrides,
  };
}

describe("SponsorGrid", () => {
  it("credits a sponsor with no website as plain text, not a dead link", () => {
    render(
      <SponsorGrid
        sponsors={[sponsor({ websiteUrl: null })]}
        canSeePerks={false}
      />,
    );
    // Twice, because this sponsor also has no logo: the plate falls back
    // to the name, and the card heading carries it too.
    expect(screen.getAllByText("Roads Rivers and Trails")).toHaveLength(2);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens a sponsor's website in a new tab with a safe rel", () => {
    render(<SponsorGrid sponsors={[sponsor()]} canSeePerks={false} />);
    const link = screen.getByRole("link", { name: /Roads Rivers and Trails/ });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("drops a stored javascript: URL to plain text", () => {
    // The write-side schema only guards writes made after it shipped, so
    // the render-time re-check is the one that matters for a row written
    // by a direct SQL edit.
    render(
      <SponsorGrid
        sponsors={[sponsor({ websiteUrl: "javascript:alert(1)" })]}
        canSeePerks={false}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a member perk for a viewer who holds the permission", () => {
    render(
      <SponsorGrid
        sponsors={[sponsor({ memberPerk: "15% off full-price gear" })]}
        canSeePerks
      />,
    );
    expect(screen.getByText("15% off full-price gear")).toBeInTheDocument();
  });

  /**
   * The role-emulation case, and the reason `canSeePerks` is a prop
   * rather than a `sponsor.memberPerk != null` test inside the card.
   *
   * The server answers the **real** principal, so a system admin
   * previewing `anonymous` is still served every perk — a
   * payload-presence check would render them and the preview would show
   * something no anonymous visitor can see. This is the same defect that
   * hid the waiver card's gate on /members/$publicId.
   */
  it("hides a perk the payload carries when the viewer can't see perks", () => {
    render(
      <SponsorGrid
        sponsors={[sponsor({ memberPerk: "15% off full-price gear" })]}
        canSeePerks={false}
      />,
    );
    expect(
      screen.queryByText("15% off full-price gear"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Members")).not.toBeInTheDocument();
  });

  it("renders no perk block for a sponsor that offers nothing", () => {
    render(
      <SponsorGrid sponsors={[sponsor({ memberPerk: null })]} canSeePerks />,
    );
    expect(screen.queryByText("Members")).not.toBeInTheDocument();
  });

  it("sets the logo decorative, since the name is already text", () => {
    // `alt=""` is why `sponsors` has no `logo_alt` column: an alt of the
    // sponsor's name would make a screen reader announce it twice.
    const { container } = render(
      <SponsorGrid
        sponsors={[
          sponsor({
            logoKey: "sponsors/spon_1/a1b2c3d4e5f60718.webp",
            logoWidthPx: 320,
            logoHeightPx: 96,
          }),
        ]}
        canSeePerks={false}
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    // Dimensions ride along to reserve the right ratio while it decodes.
    expect(img).toHaveAttribute("width", "320");
    expect(img).toHaveAttribute("height", "96");
  });

  it("falls back to the name in type when no mark is on file", () => {
    const { container } = render(
      <SponsorGrid
        sponsors={[sponsor({ logoKey: null })]}
        canSeePerks={false}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    // Twice: once on the plate, once as the card's heading.
    expect(screen.getAllByText("Roads Rivers and Trails")).toHaveLength(2);
  });

  it("centres the manage row's controls against the text block", () => {
    // The handle, the logo and the icon buttons are all fixed-height and
    // the text block beside them is two or three lines tall, so a row
    // aligned to `items-start` leaves them visibly high — measured at 8px
    // of space above and 20px below. Every other sortable list in the app
    // (`honorary-members`, `roles-list-editor`) centres its row; this one
    // and /volunteer's shipped top-aligned.
    const { container } = render(
      <SponsorGrid sponsors={[sponsor()]} canSeePerks canManage />,
    );
    const row = container.querySelector("li");
    expect(row?.className).toContain("items-center");
    expect(row?.className).not.toContain("items-start");
  });

  it("says so when there are no sponsors at all", () => {
    render(<SponsorGrid sponsors={[]} canSeePerks={false} />);
    expect(screen.getByText(/No sponsors listed yet/)).toBeInTheDocument();
  });
});

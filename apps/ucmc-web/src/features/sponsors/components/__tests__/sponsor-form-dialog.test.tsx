import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SponsorFormDialog } from "#/features/sponsors/components/sponsor-form-dialog";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";

vi.mock("#/features/sponsors/api/use-sponsor-mutations", () => ({
  useCreateSponsor: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSponsor: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe("SponsorFormDialog", () => {
  /**
   * Regression: opening the dialog threw React #185 ("Maximum update
   * depth exceeded") in production.
   *
   * `useImageResize`'s `reset` was a plain function declared in the hook
   * body, so it got a fresh identity on every render. The dialog listed
   * it in a `useEffect` dep array, and that effect calls
   * `setForm(seedToForm(seed))` — a **new object literal** every time, so
   * React could never bail out of the update. Render → effect → setState
   * → render → new `reset` identity → effect → … forever.
   *
   * Mounting with a non-null seed is the whole reproduction; a render
   * loop surfaces as a thrown error rather than an assertion failure.
   */
  it("opens for a new sponsor without looping", () => {
    expect(() =>
      render(
        <SponsorFormDialog
          seed={{ mode: "create" }}
          canSeePerks
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Add sponsor")).toBeInTheDocument();
  });

  it("opens for an existing sponsor without looping", () => {
    expect(() =>
      render(
        <SponsorFormDialog
          seed={{ mode: "edit", sponsor: sponsor() }}
          canSeePerks
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(
      screen.getByDisplayValue("Roads Rivers and Trails"),
    ).toBeInTheDocument();
  });

  it("hides the perk field from a manager without the perks grant", () => {
    // The field is hidden because the payload never carried the stored
    // value — rendering it would show blank and then submit that blank
    // over a code they can't see.
    render(
      <SponsorFormDialog
        seed={{ mode: "edit", sponsor: sponsor({ memberPerk: undefined }) }}
        canSeePerks={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Member perk")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows the perk field, seeded, for a manager who holds the grant", () => {
    render(
      <SponsorFormDialog
        seed={{
          mode: "edit",
          sponsor: sponsor({ memberPerk: "15% off full-price gear" }),
        }}
        canSeePerks
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByDisplayValue("15% off full-price gear"),
    ).toBeInTheDocument();
  });
});

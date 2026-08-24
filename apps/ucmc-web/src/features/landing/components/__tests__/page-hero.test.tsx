/**
 * `<PageHero />` — the band shared by all eight public pages.
 *
 * These pin the two things that are easy to undo by "tidying": every hero
 * is the same height regardless of `size`, and the band centres its
 * content vertically. The second is what makes the first survive — an
 * interior page's copy is far shorter than home's, so without centring a
 * full-height band strands its text against the top edge.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageHero } from "#/features/landing/components/page-hero";
import { HERO_PAGES } from "#/features/landing/lib/hero-pages";

// The band reads its copy through a server fn; the registry defaults are
// what render before it resolves, and they're what these assert against.
vi.mock("#/features/landing/api/queries", () => ({
  pageHeroQueryOptions: (page: string) => ({
    queryKey: ["landing", "page-hero", page],
    queryFn: () => new Promise(() => undefined),
  }),
}));

// The edit affordance and the gallery both pull in the router / R2 image
// layer, neither of which this is about.
vi.mock("#/features/landing/components/edit-affordance", () => ({
  EditAffordance: () => null,
}));
vi.mock("#/features/landing/components/hero-gallery", () => ({
  HeroGallery: () => null,
}));

function renderHero(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return container.querySelector("section")!;
}

describe("<PageHero />", () => {
  it("gives every page the same band height, whatever the size", () => {
    // The subpage heroes shipped at 220/280px and read as a thin strip
    // next to home's. Height is deliberately not part of `size` any more,
    // so a compact hero can't drift shorter again.
    const compact = renderHero(<PageHero page="policies" />);
    const full = renderHero(<PageHero page="home" size="full" />);

    for (const section of [compact, full]) {
      expect(section.className).toContain("min-h-[420px]");
      expect(section.className).toContain("md:min-h-[560px]");
    }
  });

  it("centres an interior hero's content in the band", () => {
    // Load-bearing for the shared height: an interior page has no logo
    // and no CTA pair, so its copy is much shorter than the band (488px
    // against 560px at 1280, measured) and would otherwise sit against
    // the top edge.
    const section = renderHero(<PageHero page="gear_cave" />);
    expect(section.className).toContain("justify-center");
  });

  it("leaves the home hero top-aligned", () => {
    // Home's content is shorter than the band too, so centring it would
    // move the front door's copy down ~72px. Matching the subpages'
    // height was the ask; restyling home was not.
    const section = renderHero(<PageHero page="home" size="full" />);
    expect(section.className).not.toContain("justify-center");
  });

  it("keeps a smaller heading on interior pages than on home", () => {
    // Same silhouette, different emphasis — the band matches home's
    // height without every page reading as a second front door.
    const compact = renderHero(<PageHero page="album" />);
    const full = renderHero(<PageHero page="home" size="full" />);

    expect(compact.querySelector("h1")!.className).toContain("md:text-4xl");
    expect(full.querySelector("h1")!.className).toContain("md:text-6xl");
  });

  it("renders the registry copy as the page's h1", () => {
    renderHero(<PageHero page="gear_cave" />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: HERO_PAGES.gear_cave.defaultHeading,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(HERO_PAGES.gear_cave.defaultTagline),
    ).toBeInTheDocument();
  });
});

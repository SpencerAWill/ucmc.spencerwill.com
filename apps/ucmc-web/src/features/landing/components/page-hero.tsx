/**
 * The hero band shared by every public page.
 *
 * One component, one editor, one data path — the home page is just the
 * `home` entry in `HERO_PAGES`, not a special case. Adding a hero to
 * another page is a registry entry plus `<PageHero page="…" />` in the
 * route.
 *
 * **The hero carries the page's `<h1>`.** Pages that adopt one drop the
 * title out of their own header (keeping any action buttons), so the
 * name appears once and there's a single accessible page heading.
 *
 * Lives in `features/landing` because that feature owns the editable-
 * content CMS this reads from — the R2 image pipeline, the slide
 * mutations, and the edit affordance are all here. Routes may import any
 * feature, so the seven subpages reach it directly; the alternative (a
 * separate feature) would have to duplicate the image layer, since
 * features can't import each other.
 */
import { useQuery } from "@tanstack/react-query";

import { pageHeroQueryOptions } from "#/features/landing/api/queries";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { HeroEditor } from "#/features/landing/components/hero-editor";
import { HeroGallery } from "#/features/landing/components/hero-gallery";
import { HERO_PAGES } from "#/features/landing/lib/hero-pages";
import type { HeroPage } from "#/features/landing/lib/hero-pages";
import { cn } from "#/lib/utils";

export interface PageHeroProps {
  page: HeroPage;
  /**
   * Rendered under the tagline — the home page's Join / Sign in buttons,
   * its logo, anything else page-specific. Kept as a slot so the shared
   * band doesn't grow a prop per page.
   */
  children?: React.ReactNode;
  /**
   * Shorter band for subpages. The home hero is the first thing a visitor
   * sees and earns its height; an interior page's hero sits above real
   * content and shouldn't push it below the fold.
   */
  size?: "full" | "compact";
}

export function PageHero({ page, children, size = "compact" }: PageHeroProps) {
  // `placeholderData` is the registry default, so the title paints
  // immediately on a cold load instead of the band jumping when the
  // query resolves. The server sends the same defaults when no row
  // exists, so this agrees with SSR rather than flashing past it.
  const defaults = HERO_PAGES[page];
  const { data } = useQuery({
    ...pageHeroQueryOptions(page),
    placeholderData: {
      page,
      heading: defaults.defaultHeading,
      tagline: defaults.defaultTagline,
      slides: [],
    },
  });

  const heading = data?.heading ?? defaults.defaultHeading;
  const tagline = data?.tagline ?? defaults.defaultTagline;
  const slides = data?.slides ?? [];
  const hasSlides = slides.length > 0;

  return (
    <section
      className={cn(
        // `group/hero` is what the gallery's hover-revealed arrows key
        // off — the whole band is the hover target, not the strip of
        // image under a button.
        "group/hero relative isolate overflow-hidden border-b",
        size === "full"
          ? "min-h-[420px] md:min-h-[560px]"
          : "min-h-[220px] md:min-h-[280px]",
      )}
    >
      {hasSlides ? (
        <>
          <HeroGallery slides={slides} />
          {/* Dark scrim so overlay text reads against any image. */}
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60"
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-primary/15 via-background to-background" />
      )}

      <div
        className={cn(
          "relative z-10 mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 text-center",
          size === "full" ? "py-20 md:py-28" : "py-12 md:py-16",
          hasSlides && "text-white",
        )}
      >
        <div className="space-y-4">
          <h1
            className={cn(
              "text-balance font-bold tracking-tight",
              size === "full" ? "text-4xl md:text-6xl" : "text-3xl md:text-4xl",
            )}
          >
            {heading}
          </h1>
          <p
            className={cn(
              "text-balance",
              size === "full" ? "text-lg md:text-xl" : "text-base md:text-lg",
              hasSlides ? "text-white/90" : "text-muted-foreground",
            )}
          >
            {tagline}
          </p>
        </div>
        {children}
      </div>

      <EditAffordance label="Edit hero">
        {({ close }) => (
          <HeroEditor
            page={page}
            heading={heading}
            tagline={tagline}
            slides={slides}
            onSaved={close}
          />
        )}
      </EditAffordance>
    </section>
  );
}

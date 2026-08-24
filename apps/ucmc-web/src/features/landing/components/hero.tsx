/**
 * The home page's hero — `<PageHero page="home">` plus the two things
 * only the front door has: the logo (when there's no gallery behind the
 * text) and the Join / Sign in calls to action.
 *
 * Since migration 0065 the band itself, its copy, its gallery, and its
 * editor are all shared with the seven other public heroes. What's left
 * here is the page-specific overlay content, passed through `PageHero`'s
 * `children` slot.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "#/components/ui/button";
import { pageHeroQueryOptions } from "#/features/landing/api/queries";
import { PageHero } from "#/features/landing/components/page-hero";

export function Hero() {
  // Read only to decide the logo + button variant. Same query key as
  // `PageHero`'s, so this is a cache read rather than a second fetch.
  const { data } = useQuery(pageHeroQueryOptions("home"));
  const hasSlides = (data?.slides.length ?? 0) > 0;

  return (
    <PageHero page="home" size="full">
      {/* The logo stands in for the imagery when there is none; over a
          gallery it would compete with it. */}
      {!hasSlides ? (
        <img
          src="/logo512.png"
          alt="UCMC logo"
          className="order-first h-24 w-24 md:h-32 md:w-32"
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link to="/sign-in" search={{ register: true }}>
            Join the club
          </Link>
        </Button>
        <Button asChild size="lg" variant={hasSlides ? "secondary" : "outline"}>
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </div>
    </PageHero>
  );
}

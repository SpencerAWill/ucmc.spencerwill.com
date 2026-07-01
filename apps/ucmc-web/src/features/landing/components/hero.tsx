import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { HeroEditor } from "#/features/landing/components/hero-editor";
import { HeroGallery } from "#/features/landing/components/hero-gallery";

const FALLBACK_HEADING = "University of Cincinnati Mountaineering Club";
const FALLBACK_TAGLINE =
  "Climb, hike, and summit together — UC's student-run community for climbers and mountaineers of every level.";

export function Hero() {
  const { data } = useQuery(landingContentQueryOptions());

  const heading =
    typeof data?.settings["hero.heading"] === "string"
      ? data.settings["hero.heading"]
      : FALLBACK_HEADING;
  const tagline =
    typeof data?.settings["hero.tagline"] === "string"
      ? data.settings["hero.tagline"]
      : FALLBACK_TAGLINE;
  const slides = data?.heroSlides ?? [];
  const hasSlides = slides.length > 0;

  return (
    <section className="relative isolate min-h-[420px] overflow-hidden border-b md:min-h-[560px]">
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

      {/* Overlay content */}
      <div
        className={`relative z-10 mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-20 text-center md:py-28 ${hasSlides ? "text-white" : ""}`}
      >
        {!hasSlides ? (
          <img
            src="/logo512.png"
            alt="UCMC logo"
            className="h-24 w-24 md:h-32 md:w-32"
          />
        ) : null}
        <div className="space-y-4">
          <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
            {heading}
          </h1>
          <p
            className={`text-balance text-lg md:text-xl ${hasSlides ? "text-white/90" : "text-muted-foreground"}`}
          >
            {tagline}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/sign-in" search={{ register: true }}>
              Join the club
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant={hasSlides ? "secondary" : "outline"}
          >
            <Link to="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>

      <EditAffordance label="Edit hero">
        {({ close }) => (
          <HeroEditor
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

/**
 * Auto-advancing image gallery for the hero. Mounted on the client only —
 * embla-carousel-react's hooks crash under TanStack Start's SSR (Vite's
 * SSR optimizer ends up with a different React instance). On the server we
 * render the first slide as a static `<img>` so the hero isn't blank on
 * first paint, then hydrate to the real carousel on the client.
 */
import Autoplay from "embla-carousel-autoplay";
import type { AutoplayType } from "embla-carousel-autoplay";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel";
import {
  HeroArrows,
  HeroAutoplayDial,
} from "#/features/landing/components/hero-carousel-controls";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import type { HeroSlideSummary } from "#/features/landing/server/landing-fns";
import {
  POINTER_FINE_QUERY,
  REDUCED_MOTION_QUERY,
  useMediaQuery,
} from "#/hooks/use-media-query";

export interface HeroGalleryProps {
  slides: HeroSlideSummary[];
}

const AUTOPLAY_DELAY_MS = 5000;

/**
 * One key for every hero on the site, deliberately: a visitor who paused
 * the carousel on the home page is telling us something about carousels,
 * not about that page, so the choice follows them to /album and back.
 */
const PAUSED_STORAGE_KEY = "ucmc-hero-autoplay-paused";

/**
 * Resolve the initial pause state on the client. An explicit stored
 * choice always wins; absent one, `prefers-reduced-motion: reduce` starts
 * paused, since an auto-advancing carousel is exactly the moving content
 * WCAG 2.2.2 asks us to give a pause control for — honouring the OS
 * setting means the visitor never has to reach for it.
 *
 * Read synchronously (not in an effect) because the autoplay plugin needs
 * `playOnInit` at construction; starting it and stopping it a tick later
 * would show one unwanted advance on a slow frame.
 */
function initialPaused(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const stored = window.localStorage.getItem(PAUSED_STORAGE_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch {
    // Private mode / blocked site data — fall through to the motion
    // preference rather than failing to render a hero.
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function HeroGallery({ slides }: HeroGalleryProps) {
  const [mounted, setMounted] = useState(false);
  const [paused, setPaused] = useState(initialPaused);
  const pointerFine = useMediaQuery(POINTER_FINE_QUERY);

  // Autoplay plugin instance is stable across renders so embla doesn't
  // re-attach the listener on every parent state change. Lazily built so
  // `playOnInit` can reflect the resolved pause state — on the client
  // this first render is where the ref is created, and `window` exists.
  const autoplayRef = useRef<AutoplayType | null>(null);
  if (!autoplayRef.current) {
    autoplayRef.current = Autoplay({
      delay: AUTOPLAY_DELAY_MS,
      stopOnInteraction: false,
      stopOnMouseEnter: false,
      playOnInit: !paused,
    });
  }
  const autoplay = autoplayRef.current;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Side effects stay *outside* the `setPaused` updater: React may call an
  // updater more than once for a single dispatch (StrictMode's dev
  // double-invoke, or a re-render during concurrent rendering), which
  // would stop-and-restart the plugin and write storage twice per click.
  const togglePaused = useCallback(() => {
    const next = !paused;
    setPaused(next);
    if (next) {
      autoplay.stop();
    } else {
      // `play(true)` would jump a slide immediately; the plain call
      // restarts the timer so resuming gives a full interval.
      autoplay.play();
    }
    try {
      window.localStorage.setItem(PAUSED_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable — the toggle still works for this visit.
    }
  }, [autoplay, paused]);

  const timeUntilNext = useCallback(() => autoplay.timeUntilNext(), [autoplay]);

  if (slides.length === 0) {
    return null;
  }

  // SSR path: render only the first slide statically.
  if (!mounted) {
    const first = slides[0];
    return (
      <div className="absolute inset-0">
        <img
          src={landingImageUrlFor(first.imageKey)}
          alt={first.alt}
          className="size-full object-cover"
        />
      </div>
    );
  }

  // Arrows are pointer-only and pointless with a single slide; the dial
  // is offered on every device, because it's the pause control for
  // moving content rather than a hover affordance.
  const showArrows = pointerFine && slides.length > 1;
  const showDial = slides.length > 1;

  return (
    // The `[&_[data-slot=carousel-content]]:h-full` selector reaches into
    // shadcn's CarouselContent, whose internal viewport div otherwise
    // collapses to image height and leaves whitespace below the gallery
    // on tall mobile heroes.
    <Carousel
      className="absolute inset-0 [&_[data-slot=carousel-content]]:h-full"
      opts={{ loop: true, align: "start", duration: 30 }}
      plugins={[autoplay]}
    >
      <CarouselContent className="ml-0 h-full">
        {slides.map((slide) => (
          <CarouselItem key={slide.id} className="h-full pl-0">
            <img
              src={landingImageUrlFor(slide.imageKey)}
              alt={slide.alt}
              className="size-full object-cover"
              loading="eager"
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      {showArrows ? <HeroArrows /> : null}
      {showDial ? (
        <HeroAutoplayDial
          paused={paused}
          onToggle={togglePaused}
          delayMs={AUTOPLAY_DELAY_MS}
          timeUntilNext={timeUntilNext}
        />
      ) : null}
    </Carousel>
  );
}

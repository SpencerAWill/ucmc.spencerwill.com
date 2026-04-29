/**
 * Auto-advancing image gallery for the hero. Mounted on the client only —
 * embla-carousel-react's hooks crash under TanStack Start's SSR (Vite's
 * SSR optimizer ends up with a different React instance). On the server we
 * render the first slide as a static `<img>` so the hero isn't blank on
 * first paint, then hydrate to the real carousel on the client.
 */
import Autoplay from "embla-carousel-autoplay";
import { useEffect, useRef, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import type { HeroSlideSummary } from "#/features/landing/server/landing-fns";

export interface HeroGalleryProps {
  slides: HeroSlideSummary[];
}

const AUTOPLAY_DELAY_MS = 5000;

export function HeroGallery({ slides }: HeroGalleryProps) {
  const [mounted, setMounted] = useState(false);
  // Autoplay plugin instance is stable across renders so embla doesn't
  // re-attach the listener on every parent state change.
  const autoplay = useRef(
    Autoplay({
      delay: AUTOPLAY_DELAY_MS,
      stopOnInteraction: false,
      stopOnMouseEnter: false,
    }),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

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

  return (
    // The `[&_[data-slot=carousel-content]]:h-full` selector reaches into
    // shadcn's CarouselContent, whose internal viewport div otherwise
    // collapses to image height and leaves whitespace below the gallery
    // on tall mobile heroes.
    <Carousel
      className="absolute inset-0 [&_[data-slot=carousel-content]]:h-full"
      opts={{ loop: true, align: "start", duration: 30 }}
      plugins={[autoplay.current]}
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
    </Carousel>
  );
}

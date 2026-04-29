import { useEffect, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "#/components/ui/carousel";

// TODO(content): drop trip photos into apps/web/public/landing/ and update
// the src + alt for each entry. The carousel will render placeholders until
// real images exist at these paths.
const photos = [
  { src: "/landing/trip-1.jpg", alt: "TODO(content): describe photo 1" },
  { src: "/landing/trip-2.jpg", alt: "TODO(content): describe photo 2" },
  { src: "/landing/trip-3.jpg", alt: "TODO(content): describe photo 3" },
  { src: "/landing/trip-4.jpg", alt: "TODO(content): describe photo 4" },
  { src: "/landing/trip-5.jpg", alt: "TODO(content): describe photo 5" },
  { src: "/landing/trip-6.jpg", alt: "TODO(content): describe photo 6" },
];

// embla-carousel-react's internal hooks crash under TanStack Start's SSR
// (Vite's SSR optimizer ends up with a different React instance than the one
// embla loads). Gate the real carousel on a client-side mount so SSR emits a
// layout-stable placeholder and the carousel only mounts in the browser.
function PhotoCarouselClient() {
  return (
    <Carousel className="mx-auto w-full max-w-4xl" opts={{ loop: true }}>
      <CarouselContent>
        {photos.map((photo) => (
          <CarouselItem key={photo.src} className="md:basis-1/2 lg:basis-1/3">
            <div className="aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
              <img
                src={photo.src}
                alt={photo.alt}
                className="size-full object-cover"
                loading="lazy"
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

function PhotoCarouselFallback() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {photos.slice(0, 3).map((photo) => (
          <div
            key={photo.src}
            className="aspect-[4/3] overflow-hidden rounded-lg border bg-muted"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

export function PhotoCarousel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section className="border-b bg-muted/30 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            On the wall and on the trail
          </h2>
          <p className="text-muted-foreground">
            A few moments from recent trips.
          </p>
        </div>
        {mounted ? <PhotoCarouselClient /> : <PhotoCarouselFallback />}
      </div>
    </section>
  );
}

/**
 * The hero gallery's manual controls: edge arrows and the autoplay
 * dial.
 *
 * Both live inside `<Carousel>` so they can reach `useCarousel()`, and
 * both are absolutely positioned against it — the carousel is
 * `absolute inset-0` of the hero section, so "the edges of the carousel"
 * and "the edges of the hero" are the same rectangle.
 */
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import * as React from "react";

import { useCarousel } from "#/components/ui/carousel";
import { cn } from "#/lib/utils";

/**
 * Reveal-on-hover, with focus as the second trigger. `group-hover`
 * alone would strand keyboard users: a control that only appears under a
 * pointer is a control they can tab to and never see. The `group` is the
 * hero `<section>`, so the whole hero is the hover target rather than
 * just the strip of image under the button.
 *
 * Callers gate mounting on a fine pointer, so this never has to reason
 * about touch — where a hover-revealed control either never shows or
 * sticks after a tap.
 */
const REVEAL =
  "opacity-0 transition-opacity duration-200 group-hover/hero:opacity-100 focus-visible:opacity-100";

const EDGE_BUTTON = cn(
  "absolute top-1/2 z-20 -translate-y-1/2 rounded-full p-2",
  "bg-black/35 text-white backdrop-blur-sm",
  "hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
  REVEAL,
);

/** Previous / next arrows, vertically centred on the hero's edges. */
export function HeroArrows() {
  const { scrollPrev, scrollNext } = useCarousel();
  return (
    <>
      <button
        type="button"
        onClick={scrollPrev}
        aria-label="Previous slide"
        className={cn(EDGE_BUTTON, "left-3 md:left-5")}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={scrollNext}
        aria-label="Next slide"
        className={cn(EDGE_BUTTON, "right-3 md:right-5")}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </>
  );
}

export interface HeroAutoplayDialProps {
  /** Whether autoplay is currently stopped. */
  paused: boolean;
  onToggle: () => void;
  /** Autoplay delay, to turn "time remaining" into a fraction. */
  delayMs: number;
  /** Live ms until the next advance, or null when not scheduled. */
  timeUntilNext: () => number | null;
}

const DIAL_SIZE = 26;

/**
 * A clock-face dial that drains toward the next auto-advance, and the
 * pause/resume toggle for it.
 *
 * **The sweep alternates direction between slides.** Odd-indexed slides
 * render the complement of the progress, so the wedge fills 0→full on
 * one slide and drains full→0 on the next. Both handoffs then land on a
 * matching value (full→full, empty→empty) and the dial never snaps back
 * — the phases-of-the-moon behaviour, and the reason this isn't just a
 * progress ring.
 *
 * The wedge is driven by mutating a CSS custom property from a
 * `requestAnimationFrame` loop rather than React state: at 60fps a
 * `setState` per frame would re-render the hero continuously for a
 * 26px decoration.
 *
 * Paused shows a **play** glyph, not a pause one — the glyph names the
 * action the click performs, and a pause icon on an already-paused
 * carousel invites a second click to pause it harder.
 */
export function HeroAutoplayDial({
  paused,
  onToggle,
  delayMs,
  timeUntilNext,
}: HeroAutoplayDialProps) {
  const { api } = useCarousel();
  const wedgeRef = React.useRef<HTMLSpanElement>(null);
  // Parity of the current slide decides sweep direction. Read from the
  // api and kept current via embla's own select event.
  const [invert, setInvert] = React.useState(false);

  React.useEffect(() => {
    if (!api) {
      return;
    }
    const sync = () => setInvert(api.selectedScrollSnap() % 2 === 1);
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  React.useEffect(() => {
    const node = wedgeRef.current;
    if (!node || paused) {
      return;
    }
    let frame = 0;
    const tick = () => {
      const remaining = timeUntilNext();
      if (remaining !== null && delayMs > 0) {
        // `timeUntilNext` counts down, so elapsed fraction is its
        // complement. Clamped because the plugin can briefly report a
        // value outside the delay around a manual scroll.
        const elapsed = Math.min(Math.max(1 - remaining / delayMs, 0), 1);
        node.style.setProperty(
          "--hero-dial",
          String(invert ? 1 - elapsed : elapsed),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, invert, delayMs, timeUntilNext]);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={paused ? "Resume slideshow" : "Pause slideshow"}
      className={cn(
        "absolute bottom-3 right-3 z-20 grid place-items-center rounded-full md:bottom-5 md:right-5",
        "border border-white/60 bg-black/35 text-white backdrop-blur-sm",
        "transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
      )}
      style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
    >
      {paused ? (
        <Play className="size-3 fill-current" aria-hidden="true" />
      ) : (
        <span
          ref={wedgeRef}
          aria-hidden="true"
          className="rounded-full"
          style={{
            width: DIAL_SIZE - 8,
            height: DIAL_SIZE - 8,
            // `--hero-dial` is a 0..1 fraction written by the rAF loop
            // above. The hard stop (same angle twice) keeps the wedge a
            // crisp pie slice instead of a gradient smear.
            background:
              "conic-gradient(currentColor calc(var(--hero-dial, 0) * 360deg), transparent 0)",
          }}
        />
      )}
    </button>
  );
}

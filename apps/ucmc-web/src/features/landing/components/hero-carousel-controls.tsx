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
 * **The moving edge always sweeps clockwise; what alternates is which
 * side of it is dark.** Progress is one unbroken 0→1 clockwise rotation
 * every slide. On an even slide the dark arc grows *behind* the pointer
 * (empty → full); on an odd slide the dark arc ahead of the pointer
 * *shrinks* as the pointer eats into it (full → empty). Two pointers a
 * full circle apart, chasing each other.
 *
 * So each handoff lands on a matching value — even ends full, odd starts
 * full; odd ends empty, even starts empty — without the edge ever
 * reversing. Inverting the *progress value* instead (`1 - elapsed`) also
 * matches at the handoffs, but runs the edge counter-clockwise on every
 * other slide, which reads as a bounce. The distinction is the whole
 * point of this comment: the two look identical at the boundaries and
 * completely different in motion.
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
  // Parity of the current slide decides which arc is painted (not the
  // direction — that's always clockwise). Read from the api and kept
  // current via embla's own select event.
  const [emptying, setEmptying] = React.useState(false);

  React.useEffect(() => {
    if (!api) {
      return;
    }
    const sync = () => setEmptying(api.selectedScrollSnap() % 2 === 1);
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
        // Always the raw elapsed fraction: the pointer's angle is
        // `elapsed * 360deg` on every slide, which is what keeps it
        // clockwise. The fill/drain phase is a paint decision, made in
        // the gradient below.
        node.style.setProperty("--hero-dial", String(elapsed));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, delayMs, timeUntilNext]);

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
            // above, and the stop sits at `dial * 360deg` in both
            // phases — that shared, always-increasing angle is the
            // clockwise pointer. Only the two colours swap:
            //
            //   filling  colour → stop → transparent   (dark behind)
            //   emptying transparent → stop → colour   (dark ahead)
            //
            // The trailing `0` is a hard stop: per spec a stop position
            // below the running maximum is clamped up to it, so the two
            // colours meet at one angle and the wedge stays a crisp pie
            // slice rather than a gradient smear.
            background: emptying
              ? "conic-gradient(transparent calc(var(--hero-dial, 0) * 360deg), currentColor 0)"
              : "conic-gradient(currentColor calc(var(--hero-dial, 0) * 360deg), transparent 0)",
          }}
        />
      )}
    </button>
  );
}

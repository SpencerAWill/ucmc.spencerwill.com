/**
 * The site notice: a one-line bar under the header, above the page and
 * beside — never across — the sidebar. Edited on /settings (`notice.*`).
 *
 * **One line, always.** When the text doesn't fit, the bar becomes a
 * ticker: two copies of the text slide left back to back and loop. The
 * second copy is `aria-hidden`, so a screen reader hears the notice once.
 * It pauses on hover and while anything in it has focus, and a pause/play
 * button stops it outright (WCAG 2.2.2 — anything that moves for more than five seconds
 * needs a way to stop it).
 *
 * **Reduced motion breaks the one-line rule on purpose.** Nothing moves;
 * the text wraps onto as many lines as it needs. Truncating it instead
 * would hide the end of the notice from exactly the people who asked the
 * page to sit still, and the end is often the part that matters ("…before
 * spring break trips").
 *
 * The server render and the first client render are the static, truncated
 * bar: whether the text overflows is a measurement, and the server has
 * nothing to measure. `ResizeObserver` upgrades it after mount and keeps
 * re-deciding as the width changes, so rotating a phone engages or
 * disengages the ticker.
 */
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { siteNoticeQueryOptions } from "#/features/settings/api/queries";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "#/hooks/use-media-query";
import { cn } from "#/lib/utils";
import { noticeViewerOf } from "#/server/settings/site-notice";
import type { NoticeTone, SiteNotice } from "#/server/settings/site-notice";

/** Ticker speed. Slow enough to read a word at a time on a phone. */
const MARQUEE_PX_PER_SECOND = 60;

/** The gap after each copy (`pr-12`), so the loop doesn't run words together. */
const MARQUEE_GAP_PX = 48;

/** Seconds for one loop: one copy plus its gap, at `MARQUEE_PX_PER_SECOND`. */
export function marqueeDurationSeconds(loopWidthPx: number): number {
  return loopWidthPx / MARQUEE_PX_PER_SECOND;
}

/**
 * Literal class strings per tone, so Tailwind's scanner sees every one.
 * The focus outline uses the tone's own foreground rather than `--ring`:
 * the brand-green ring is measured against the page, and on a coloured bar
 * it can vanish (green on the success tone) where the foreground is
 * already held to 4.5:1 against the fill.
 */
export const TONE_CLASSES: Record<
  NoticeTone,
  { bar: string; swatch: string; focus: string }
> = {
  info: {
    bar: "bg-notice-info text-notice-info-foreground",
    swatch: "bg-notice-info",
    focus: "focus-visible:outline-notice-info-foreground",
  },
  success: {
    bar: "bg-notice-success text-notice-success-foreground",
    swatch: "bg-notice-success",
    focus: "focus-visible:outline-notice-success-foreground",
  },
  warning: {
    bar: "bg-notice-warning text-notice-warning-foreground",
    swatch: "bg-notice-warning",
    focus: "focus-visible:outline-notice-warning-foreground",
  },
  danger: {
    bar: "bg-notice-danger text-notice-danger-foreground",
    swatch: "bg-notice-danger",
    focus: "focus-visible:outline-notice-danger-foreground",
  },
  neutral: {
    bar: "bg-notice-neutral text-notice-neutral-foreground",
    swatch: "bg-notice-neutral",
    focus: "focus-visible:outline-notice-neutral-foreground",
  },
};

/**
 * The bar itself, given a notice. Presentational, so `/settings` can
 * render a preview with it; pass `className` to override the sticky
 * positioning there.
 */
export function SiteNoticeBar({
  text,
  tone,
  className,
}: SiteNotice & { className?: string }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [paused, setPaused] = useState(false);

  const marquee = overflowing && !reducedMotion;

  // Measures the first copy's natural width against the viewport. Re-run
  // when the text or the mode changes, because both swap the element the
  // refs point at, and when reduced motion flips: the wrapped text it
  // shows measures as never overflowing, so turning it off must re-ask
  // rather than wait for a resize. The observer covers every width change
  // in between.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const measure = () => {
      const width = textRef.current?.scrollWidth ?? 0;
      setTextWidth(width);
      setOverflowing(width > viewport.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [text, marquee, reducedMotion]);

  return (
    <aside
      aria-label="Site notice"
      className={cn(
        "group/notice sticky top-(--header-height) z-20 flex min-h-9 items-center gap-2 px-4 py-1 text-sm font-medium",
        TONE_CLASSES[tone].bar,
        className,
      )}
    >
      <div
        ref={viewportRef}
        data-slot="notice-viewport"
        className="min-w-0 flex-1 overflow-hidden"
      >
        {marquee ? (
          <div
            data-slot="notice-strip"
            // Hover and focus pause in CSS rather than through handlers on
            // the landmark: no state to keep in sync, and a pointer leaving
            // mid-render can't strand it paused. The button's pause is the
            // inline style, which only ever says "paused" — an inline
            // "running" would beat these classes.
            className="inline-flex w-max group-focus-within/notice:[animation-play-state:paused] group-hover/notice:[animation-play-state:paused]"
            style={{
              animationName: "site-notice-marquee",
              animationDuration: `${marqueeDurationSeconds((textWidth ?? 0) + MARQUEE_GAP_PX)}s`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: paused ? "paused" : undefined,
            }}
          >
            <span className="pr-12">
              <span
                ref={textRef}
                data-slot="notice-text"
                className="whitespace-nowrap"
              >
                {text}
              </span>
            </span>
            <span aria-hidden="true" className="pr-12">
              <span className="whitespace-nowrap">{text}</span>
            </span>
          </div>
        ) : (
          <span
            ref={textRef}
            data-slot="notice-text"
            className={cn(
              "block",
              reducedMotion ? "whitespace-normal" : "truncate",
            )}
          >
            {text}
          </span>
        )}
      </div>
      {marquee ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={paused}
          aria-label={paused ? "Play notice" : "Pause notice"}
          className={cn(
            "size-7 shrink-0 text-current hover:bg-current/10 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:ring-0",
            TONE_CLASSES[tone].focus,
          )}
          onClick={() => setPaused((current) => !current)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
      ) : null}
    </aside>
  );
}

/**
 * The notice for whoever is viewing, from the server's answer. Keyed by
 * viewer, so signing in or out reads (and fetches) the right entry rather
 * than keeping the previous audience's. The real principal, not a role
 * preview: the server decides the audience against the session, and a
 * preview can't change what the server sent.
 */
export function SiteNoticeBanner() {
  const { principal } = useAuth();
  const { data } = useQuery(siteNoticeQueryOptions(noticeViewerOf(principal)));
  return data ? <SiteNoticeBar text={data.text} tone={data.tone} /> : null;
}

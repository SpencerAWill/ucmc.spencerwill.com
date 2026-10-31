/**
 * The site notice: a one-line bar under the header, above the page and
 * beside — never across — the sidebar. Edited on /settings (`notice.*`).
 *
 * **One line, always.** When the text doesn't fit, the bar becomes a
 * ticker: two copies of the text slide left back to back and loop. The
 * second copy is `aria-hidden`, so a screen reader hears the notice once.
 * It pauses on hover (devices that can hover), and a pause/play button
 * stops it outright (WCAG 2.2.2 — anything that moves for more than five
 * seconds needs a way to stop it). There is deliberately no focus pause:
 * the button is the only focusable thing in the bar and a tap or Enter
 * leaves it focused, so a focus-within pause held the ticker still after
 * Play until the user tapped somewhere else.
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
import type { Ref } from "react";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { siteNoticeQueryOptions } from "#/features/settings/api/queries";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "#/hooks/use-media-query";
import { cn } from "#/lib/utils";
import { noticeViewerOf } from "#/server/settings/site-notice";
import type { NoticeTone, SiteNotice } from "#/server/settings/site-notice";

/** The live bar's measured height, on `<html>`; read by `--page-sticky-top`. */
export const NOTICE_HEIGHT_PROPERTY = "--site-notice-height";

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
  ref,
}: SiteNotice & { className?: string; ref?: Ref<HTMLElement> }) {
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
      ref={ref}
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
            // Hover pauses in CSS rather than through handlers on the
            // landmark: no state to keep in sync, and Tailwind's hover
            // variants only apply where the device can hover, so a tap
            // can't leave it stuck. The button's pause is the inline
            // style, which only ever says "paused" — an inline "running"
            // would beat this class.
            className="inline-flex w-max group-hover/notice:[animation-play-state:paused]"
            style={{
              animationName: "site-notice-marquee",
              animationDuration: `${marqueeDurationSeconds((textWidth ?? 0) + MARQUEE_GAP_PX)}s`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: paused ? "paused" : undefined,
            }}
          >
            <span className="pr-12">
              {/* `inline-block`, not inline: an inline box measures a
                  `scrollWidth` of 0, which reads as fitting, switches the
                  ticker off, measures as overflowing again, and loops
                  until React gives up (error #185). */}
              <span
                ref={textRef}
                data-slot="notice-text"
                className="inline-block whitespace-nowrap"
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
              "block text-center",
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
  const barRef = useRef<HTMLElement>(null);
  // Re-run when the bar comes or goes, not on every refetch: the
  // observer already follows its height while it stays.
  const hasBar = Boolean(data);

  // Publishes the bar's height so a page's own sticky element can stop
  // under it (`--page-sticky-top`, set by the shell) rather than sliding
  // beneath. Measured, not assumed: reduced motion wraps the text onto
  // as many lines as it needs. Absent when there is no bar, so the
  // shell's fallback of 0 applies.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(NOTICE_HEIGHT_PROPERTY, `${bar.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(NOTICE_HEIGHT_PROPERTY);
    };
  }, [hasBar]);

  return data ? (
    <SiteNoticeBar ref={barRef} text={data.text} tone={data.tone} />
  ) : null;
}

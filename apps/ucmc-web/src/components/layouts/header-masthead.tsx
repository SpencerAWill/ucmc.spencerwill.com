import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { CLUB_TIME_ZONE } from "#/config/time";
import { publicBrandingQueryOptions } from "#/features/settings/api/queries";
import { CURRENT_YEAR_TOKEN } from "#/server/settings/settings-registry";

/**
 * The header masthead: the logo badge with configurable text either
 * side of it, the whole thing one link home.
 *
 * The two text halves are `appearance.*` site settings, so this reads
 * them rather than hardcoding club copy; either can be blanked to show
 * nothing. Both are hidden at narrow widths and the logo alone carries
 * the header — the middle column is one third of a header that also
 * holds the sidebar trigger and three icon buttons, so there is no room
 * to fit them on a phone. The title appears at `md`, the tagline at
 * `lg`, which is where each first has the width to sit on one line.
 *
 * The badge sits *between* the two halves rather than ahead of them, so
 * the whole reads as a masthead centred on the mark instead of an icon
 * with a caption. The logo's own lettering is illegible at 32px, which
 * is why the title next to it isn't redundant.
 *
 * The tagline is de-emphasised by size and weight only — **do not add a
 * `text-primary-foreground/NN` opacity to it.** Against the light
 * theme's `--primary`, the full-opacity foreground is 5.09:1, /95 is
 * 4.76:1, and /90 is already 4.44:1 — so anything below full opacity
 * either fails WCAG AA for 12px text or clears it by less than axe's
 * own measurement error. `/75` shipped once and failed the axe job on
 * all 13 audited routes at 3.3:1, because this header renders on every
 * page. The dark theme passes at every alpha, so light is the binding
 * constraint and eyeballing dark will mislead.
 */
export function HeaderMasthead() {
  const options = publicBrandingQueryOptions();
  const { data: branding = options.placeholderData } = useQuery(options);

  // Expanded here rather than in the server payload so a cached
  // response can't serve last year's number. Pinned to CLUB_TIME_ZONE
  // for the usual reason *and* one specific to rendering: the worker
  // resolves this in UTC and the browser would otherwise use its own
  // zone, so around New Year the SSR and hydration passes could
  // disagree and React would report a mismatch.
  const tagline = branding.headerTagline.replaceAll(
    CURRENT_YEAR_TOKEN,
    String(Temporal.Now.instant().toZonedDateTimeISO(CLUB_TIME_ZONE).year),
  );

  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-center">
      {/* The whole masthead is one link — title, mark, and tagline —
          so anywhere on the visible wordmark goes home, not just the
          badge.
          `inline-flex` rather than filling the column: the column is a
          third of the header, and a link stretched across all of it
          would turn a wide band of empty space either side of the logo
          into a navigation target that fires on a mistaken thumb tap.
          Sized to its content, the hit area is exactly the masthead.
          An explicit aria-label names the link, which matters at narrow
          widths where the title is `display: none` and the only child
          left is an `alt=""` image. It leads with the visible title so
          the accessible name contains it (WCAG 2.5.3, Label in Name). */}
      <Link
        to="/"
        aria-label={
          branding.headerTitle ? `${branding.headerTitle} — home` : "UCMC home"
        }
        className="inline-flex min-w-0 items-center gap-x-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current lg:gap-x-3"
      >
        {branding.headerTitle ? (
          <span className="hidden truncate text-sm font-bold tracking-tight md:inline">
            {branding.headerTitle}
          </span>
        ) : null}
        <img src="/logo192.png" alt="" className="h-8 w-auto shrink-0" />
        {tagline ? (
          <span className="hidden whitespace-nowrap text-xs font-normal lg:inline">
            {tagline}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

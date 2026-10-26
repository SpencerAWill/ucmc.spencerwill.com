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
 * `text-header-foreground/NN` opacity to it.** Against the light
 * theme's `--header`, the full-opacity foreground is 5.09:1, /95 is
 * 4.76:1, and /90 is already 4.44:1 — so anything below full opacity
 * either fails WCAG AA for 12px text or clears it by less than axe's
 * own measurement error. `/75` shipped once and failed the axe job on
 * all 13 audited routes at 3.3:1, because this header renders on every
 * page. The dark theme passes at every alpha, so light is the binding
 * constraint and eyeballing dark will mislead.
 */
function homeLinkLabel(title: string, tagline: string): string {
  const visible = [title, tagline].filter(Boolean);
  return visible.length > 0 ? `${visible.join(", ")} — home` : "UCMC home";
}

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
      {/* The whole middle column is one link — mark and both strings —
          so anywhere in it goes home, not just the badge.

          Centring: the *mark alone* is in normal flow, so
          `justify-center` puts it at the exact centre of the middle
          column, and since the header's three columns are equal
          `flex-1` thirds, that is the centre of the page. The two
          strings are absolutely positioned off the mark's own wrapper
          (`right-full` / `left-full`), so they hang either side of it
          without being able to move it.
 
          That indirection is the point. Anything that puts the strings
          in flow beside the mark shifts the mark by their difference in
          width: content-sizing the link centres the *group*, which
          pushed the mark ~39px right at 1280 because the title is wider
          than the tagline. Equal-width flex or grid tracks fix the
          centring but bill it to the title — each track is half the
          column, so at 800px the title truncated to "UC Mountain…"
          while the tagline's half sat empty. Out of flow, the title can
          use the empty space in the left third instead, and the mark
          still cannot move.

          The caps stop a long title or tagline reaching the sidebar
          trigger or the icon buttons in the outer thirds: at the
          narrowest width each string renders at (768px / `md` for the
          title, 1024px / `lg` for the tagline) there is more room than
          the cap allows, so the cap bounds overlap while `truncate`
          handles the pathological value the 60/40-char setting limits
          still permit.

          An explicit aria-label names the link, which matters at narrow
          widths where both strings are `display: none` and the only
          child left is an `alt=""` image. It carries both visible
          strings so the accessible name contains all the visible text
          (WCAG 2.5.3, Label in Name) — axe 4.14 checks every word, and a
          label naming only the title failed on every page at `lg`, where
          the tagline shows. */}
      <Link
        to="/"
        aria-label={homeLinkLabel(branding.headerTitle, tagline)}
        className="relative flex w-full items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <span className="relative flex shrink-0 items-center">
          <span className="absolute right-full top-1/2 mr-2 hidden max-w-72 -translate-y-1/2 truncate text-right text-sm font-bold tracking-tight md:block lg:mr-3">
            {branding.headerTitle}
          </span>
          <img src="/logo192.png" alt="" className="h-8 w-auto" />
          {/* The space is text, not layout — a flex container drops
              whitespace-only children from its boxes, so it moves
              nothing. Without it the two strings concatenate to
              "…ClubEst. 1971…" in the computed visible text, a word the
              label can never contain, and axe's Label in Name check
              fails however the label is written. Only rendered between
              two strings, so a blank masthead keeps an empty link. */}
          {branding.headerTitle && tagline ? " " : null}
          <span className="absolute left-full top-1/2 ml-2 hidden max-w-56 -translate-y-1/2 truncate text-left text-xs font-normal lg:block lg:ml-3">
            {tagline}
          </span>
        </span>
      </Link>
    </div>
  );
}

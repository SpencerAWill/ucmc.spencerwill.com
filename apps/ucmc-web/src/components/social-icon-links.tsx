/**
 * The club's social profile icons as a horizontal row of external links.
 *
 * Rendered in two places — the app footer and the landing page's "Where
 * to find us" card — which is the whole reason it's a component: the
 * URL/icon/label triples used to be duplicated (footer hardcoded all
 * three; the landing page read Instagram from the landing CMS and didn't
 * show the other two at all), so the two surfaces could disagree about
 * where the club actually lives online.
 *
 * Deliberately takes plain URL strings rather than reading
 * `publicSiteContactQueryOptions` itself. That keeps it presentational
 * and dependency-free, so it can sit in `src/components/` without
 * reaching into `src/features/` — and it lets each caller decide whether
 * to render during the placeholder-data phase. The URLs come from the
 * `contact.*` site settings; edit them at /settings.
 *
 * A blank URL means "the club has no such account" and drops that icon
 * entirely — an icon linking to "" would resolve as a same-origin
 * navigation back to the current page.
 */
import {
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
} from "#/components/brand-icons";
import { cn } from "#/lib/utils";

export interface SocialIconLinksProps {
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl: string;
  /** Applied to the wrapping flex row, for gap/alignment tweaks. */
  className?: string;
  /** Tailwind size utility for the glyphs. Footer uses `size-5`. */
  iconClassName?: string;
}

export function SocialIconLinks({
  instagramUrl,
  facebookUrl,
  youtubeUrl,
  className,
  iconClassName = "size-5",
}: SocialIconLinksProps) {
  const links = [
    { label: "Instagram", href: instagramUrl, Icon: InstagramIcon },
    { label: "Facebook", href: facebookUrl, Icon: FacebookIcon },
    { label: "YouTube", href: youtubeUrl, Icon: YouTubeIcon },
  ].filter((link) => link.href.length > 0);

  if (links.length === 0) {
    return null;
  }

  // A `<span>`, not a `<div>`: the landing page renders this inside the
  // `<p>` that holds a row's value, and a block element there is invalid
  // HTML — React reparents it during hydration and the markup mismatches.
  // `inline-flex` is valid in phrasing content and still lays out
  // correctly as a flex item in the footer's row.
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {links.map(({ label, href, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center transition-opacity hover:opacity-80"
          // The glyphs are `aria-hidden`, so the accessible name has to
          // come from here or the link announces as its bare URL.
          aria-label={`UCMC on ${label}`}
        >
          <Icon className={iconClassName} />
        </a>
      ))}
    </span>
  );
}

/**
 * Renders a badge: its artwork, masked to the badge's shape, inside a
 * tier-coloured frame.
 *
 * Lives in `src/components/` rather than a feature because the member
 * profile, the directory and (later) `/my` all show badges, and
 * features can't import each other — the same route the curated icon
 * registry took.
 *
 * **The artwork is a file, not a glyph.** `BADGES[key].art` names a
 * file under `public/badges/`, and everything about how a badge looks
 * is in that file: swapping in painted or photographed art is a
 * commit, not a code change. The mask is applied here so any source
 * image lands in the same silhouette as its neighbours, whatever its
 * own edges do.
 *
 * `resolveBadgeArt` is the seam for officer-uploaded overrides later
 * (issue #257): point it at an R2 key when one exists and fall back
 * to the repo file. Call sites don't change.
 */
import { cn } from "#/lib/utils";
import type {
  BadgeShape,
  BadgeTier,
} from "#/server/member-profile/badge-registry";

/**
 * Path to a badge's artwork.
 *
 * `public/` is served unhashed, which is the point: an officer can be
 * told "replace `public/badges/white-oak.svg`" and that is the whole
 * procedure. It also means the browser may hold a stale copy of
 * replaced art for a while, which is the right trade for a file that
 * changes about never.
 */
export function resolveBadgeArt(art: string): string {
  return `/badges/${art}`;
}

/**
 * Outlines in a 100×100 box.
 *
 * Hand-written paths rather than CSS `clip-path` polygons because the
 * same path does double duty as the frame stroke — one source of
 * truth means the frame can never sit a pixel off the mask it traces.
 */
const SHAPE_PATHS: Record<BadgeShape, string> = {
  hex: "M50 3 93 27v46L50 97 7 73V27Z",
  circle: "M50 4a46 46 0 1 0 .1 0Z",
  shield: "M50 3 92 16v38c0 22-18 35-42 43C26 89 8 76 8 54V16Z",
};

/**
 * Frame colours. Untiered badges take the brand green rather than a
 * metal — a bronze frame on a badge with no tiers would imply it has
 * a silver the member is missing.
 */
const TIER_STROKE: Record<BadgeTier, string> = {
  bronze: "oklch(0.6 0.11 50)",
  silver: "oklch(0.72 0.01 260)",
  gold: "oklch(0.74 0.14 80)",
};

export interface BadgeEmblemProps {
  art: string;
  shape: BadgeShape;
  /** `null` for an untiered badge. */
  tier?: BadgeTier | null;
  /**
   * Drains the colour and dashes the frame, for a badge in the
   * catalog that this member hasn't earned (or that isn't earnable
   * yet). Still shows the art, because the point of a locked badge is
   * to be wanted.
   */
  locked?: boolean;
  /**
   * Decorative by default: the badge's name is always rendered beside
   * it by the caller, and a duplicate label is noise to a screen
   * reader. Pass a name only where the emblem stands alone.
   */
  label?: string;
  className?: string;
}

export function BadgeEmblem({
  art,
  shape,
  tier = null,
  locked = false,
  label,
  className,
}: BadgeEmblemProps) {
  // Unique per instance so two emblems on one page can't share a
  // clip path — SVG ids are document-global, and React 18's
  // `useId` output is valid in one.
  const clipId = `badge-clip-${shape}-${art.replace(/\W/g, "-")}${locked ? "-l" : ""}`;
  const path = SHAPE_PATHS[shape];

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("size-16 shrink-0", locked && "opacity-60", className)}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
      </defs>
      {/* A surface behind the art, so a transparent PNG lands on
          something rather than on whatever card is underneath. */}
      <path d={path} className="fill-muted" />
      <image
        href={resolveBadgeArt(art)}
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${clipId})`}
        className={cn(locked && "grayscale")}
      />
      <path
        d={path}
        fill="none"
        strokeWidth={locked ? 3 : 4}
        strokeDasharray={locked ? "6 5" : undefined}
        stroke={tier ? TIER_STROKE[tier] : "var(--primary)"}
      />
    </svg>
  );
}

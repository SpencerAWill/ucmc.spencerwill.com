/**
 * The contour band behind a profile header.
 *
 * Rendered as inline SVG rather than a canvas so it exists in the SSR
 * HTML: a canvas would paint only after hydration, which on a slow
 * connection is a coloured rectangle that becomes terrain a second
 * later, right under the member's name.
 *
 * Decorative, so it is `aria-hidden` and carries no label. It encodes
 * nothing a reader needs — it just stops every profile looking the
 * same.
 */
import { TOPO_VIEWBOX, topoLines } from "#/features/members/lib/topo-banner";
import { cn } from "#/lib/utils";

export function TopoBanner({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const lines = topoLines(seed);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[var(--header)]",
        // Short on a phone, where vertical space is the scarce thing
        // and the header below it matters more than the scenery.
        // Tall enough that the back link overlaid on it clears the
        // avatar pulled up over its lower edge.
        "h-28 sm:h-36 md:h-44",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${TOPO_VIEWBOX.width} ${TOPO_VIEWBOX.height}`}
        preserveAspectRatio="none"
        className="size-full"
      >
        {lines.map((line, i) => (
          <path
            key={i}
            d={line.d}
            fill="none"
            stroke="var(--header-foreground)"
            strokeWidth={line.major ? 2 : 1}
            strokeOpacity={line.major ? 0.45 : 0.22}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {/* Fades the band into the page so the avatar overlapping its
          lower edge doesn't sit on a hard seam. */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}

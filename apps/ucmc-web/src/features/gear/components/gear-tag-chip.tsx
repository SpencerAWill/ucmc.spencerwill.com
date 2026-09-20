import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

/**
 * A gear tag, shaped like a tag.
 *
 * Tags used to be prefixed with a `#`, which was the only thing telling
 * them apart from the state chips beside them — Available, Serviceable,
 * Needs repair. Dropping the hash (they are chips, not hashtags) left
 * two kinds of chip wearing the same rounded-full pill and saying quite
 * different kinds of thing: one is a fact the system derived, the other
 * a label somebody chose to stick on.
 *
 * So the difference moved into the silhouette. A notched left edge and
 * a punched eyelet read as a luggage tag at a glance and at small size,
 * which is the only size these ever render at. No icon is needed and no
 * character is prepended to the name.
 *
 * Three implementation notes:
 *
 *   - **No border.** `clip-path` cuts the border with the box, leaving
 *     a raw sliced edge along the notch. The muted fill carries the
 *     shape instead.
 *   - **The fill is muted but the text is not.** Tags sit on cards and
 *     inside popovers that are themselves close to `muted`, so a
 *     `muted-foreground` label on a `muted` fill came out nearly
 *     unreadable. The quiet fill keeps them visually below the state
 *     chips without costing legibility.
 *   - **The eyelet is a dark dot, not a hole punched to the page.**
 *     Punching through to `bg-background` only lines up when the chip
 *     sits directly on the page background; these also render on cards
 *     (`bg-card`) and inside popovers, where it would show as a patch
 *     of the wrong colour. A translucent foreground dot reads as an
 *     eyelet on any of them.
 */
export function GearTagChip({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  /** Trailing content inside the chip — the multiselect puts its
   *  remove button here. */
  children?: ReactNode;
}) {
  return (
    <span
      data-slot="gear-tag-chip"
      className={cn(
        "relative inline-flex w-fit shrink-0 items-center gap-1 py-0.5 pr-2 pl-4",
        "bg-muted text-xs font-medium whitespace-nowrap text-foreground",
        "[clip-path:polygon(0.5rem_0,100%_0,100%_100%,0.5rem_100%,0_50%)]",
        // The eyelet, sitting just inside the point.
        "before:absolute before:top-1/2 before:left-2 before:size-[3px]",
        "before:-translate-y-1/2 before:rounded-full before:bg-foreground/30",
        className,
      )}
    >
      {name}
      {children}
    </span>
  );
}

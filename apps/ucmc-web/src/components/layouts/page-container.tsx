/**
 * The one horizontal gutter and measure for page content.
 *
 * `AppLayout` deliberately gives `<main>` no padding, because the landing
 * page and every `PageHero` are full-bleed and would be boxed in by a
 * container on the shell. So each page opens its own — which is exactly
 * how six width tiers and five padding schemes drifted in: `px-6` here,
 * `p-4` there, `p-4 sm:p-6` somewhere else, so the text edge jumped by
 * 8px as you navigated between two pages that look like peers.
 *
 * The gutter is therefore fixed (`px-4 sm:px-6`) and not overridable
 * through the variant — that is the part the eye tracks across a
 * navigation. Only the measure varies, because a waiver table genuinely
 * needs more room than a policy page:
 *
 * - `focused` — signed-out interstitials (sign-in, verify e-mail). One
 *   card, centred, generous vertical air.
 * - `prose`   — policy, legal, and marketing copy. ~65ch at the body
 *   size, which is the readable-line-length cap, not a taste call.
 * - `app`     — signed-in single-column pages: forms, card stacks,
 *   detail views. One step wider than `prose`, since a form row is
 *   wider than a line of text but still reads top-to-bottom.
 * - `wide`    — tables and grids that earn the extra columns.
 *
 * Content spacing (`space-y-*`, `flex flex-col gap-*`) stays with the
 * page and comes through `className`; `cn` settles it against the
 * variant deterministically rather than by stylesheet order.
 */
import { cn } from "#/lib/utils";

const WIDTHS = {
  focused: "max-w-md py-12 sm:py-16",
  prose: "max-w-2xl py-8 sm:py-12",
  app: "max-w-3xl py-6 sm:py-8",
  wide: "max-w-5xl py-6 sm:py-8",
} as const;

export type PageWidth = keyof typeof WIDTHS;

/**
 * `width` has no default on purpose: picking a measure is a design
 * decision per page, and an implicit one is how the drift started.
 */
export function PageContainer({
  width,
  className,
  children,
}: {
  width: PageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6", WIDTHS[width], className)}
    >
      {children}
    </div>
  );
}

/**
 * The one place a TanStack Chart is mounted.
 *
 * Every chart on `/analytics` goes through here so four obligations are
 * met once instead of per panel:
 *
 *  1. **Palette.** `.ts-chart-themed` bridges our `--chart-1..6` onto
 *     the library's `--ts-chart-1..6` (see `styles.css`). Charts never
 *     name a colour.
 *  2. **A name.** `ariaLabel` is required by the library, and required
 *     here too — the prop is non-optional so there is no way to mount
 *     an unlabelled chart.
 *  3. **Deterministic SSR.** `initialWidth` + `height` give the server
 *     a real size to render at, so the complete SVG is in the HTML
 *     response and nothing pops at hydration. This is the reason the
 *     library was chosen over Recharts, whose `ResponsiveContainer`
 *     measures on the client and renders nothing on the server — so
 *     **do not drop these props** to "let CSS handle it": without a
 *     height the server falls back to 320 and the first paint jumps.
 *  4. **An exact-value alternative.** Colour alone is never sufficient
 *     and a chart is not readable by every reader, so a panel passes
 *     `table` and gets a real `<table>` in a disclosure beneath. Three
 *     of our six palette slots also sit under 3:1 against the card
 *     (aqua, yellow, pink — see `styles.css`), which makes the table an
 *     obligation rather than a nicety whenever those slots are in play.
 */
import { Chart } from "@tanstack/charts/react";
import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

/**
 * Matches the `wide` page container at its common widths. The browser
 * remeasures after mount, so this only has to be close — it decides
 * how much the first responsive adjustment moves, not the final size.
 */
const SSR_WIDTH = 720;

export function ChartSurface({
  definition,
  ariaLabel,
  ariaDescription,
  height = 220,
  table,
  className,
}: {
  definition: ComponentProps<typeof Chart>["definition"];
  ariaLabel: string;
  ariaDescription?: string;
  height?: number;
  /** Exact values, rendered in a disclosure under the chart. */
  table?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ts-chart-themed", className)}>
      <Chart
        definition={definition}
        ariaLabel={ariaLabel}
        ariaDescription={ariaDescription}
        height={height}
        initialWidth={SSR_WIDTH}
      />
      {table ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Show values
          </summary>
          <div className="mt-2 overflow-x-auto overflow-y-hidden">{table}</div>
        </details>
      ) : null}
    </div>
  );
}

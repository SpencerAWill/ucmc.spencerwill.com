/**
 * Two or three seasons overlaid on one season axis — a line per
 * season, x = month-position within the season (0 = August).
 *
 * **This is the comparison the whole time model exists for.** Because
 * both lines are indexed to their own season's August rather than to a
 * calendar month, a partial current season simply stops early against
 * the same point in prior ones, with no alignment logic: October of
 * this season sits directly above October of last.
 *
 * Deliberately a line and not a grouped bar. The reader's task is
 * "same month, different season", which a line answers by vertical
 * distance at one x position; grouped bars make the eye hop between
 * pairs and get unreadable past two series.
 *
 * Two or three series only. Our categorical palette has six slots and
 * is never cycled, but more than three seasons on one axis is spaghetti
 * regardless of colour — four or more belongs in small multiples.
 */
import { defineChart, lineY } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { useMemo } from "react";

import { ChartSurface } from "#/features/analytics/components/chart-surface";
import { SEASON_MONTH_LABELS } from "#/features/analytics/components/season-axis-chart";

export interface SeasonOverlayPoint {
  season: string;
  monthIndex: number;
  value: number;
}

export function SeasonOverlayChart({
  points,
  valueLabel,
  ariaLabel,
  ariaDescription,
  table,
}: {
  points: SeasonOverlayPoint[];
  valueLabel: string;
  ariaLabel: string;
  ariaDescription?: string;
  table?: React.ReactNode;
}) {
  const rows = useMemo(
    () =>
      // Sorted by month index within each season: input order is path
      // order for a line mark, so an unsorted array draws a scribble
      // rather than a trend. The SSR guide calls this out explicitly.
      [...points]
        .sort(
          (a, b) =>
            a.season.localeCompare(b.season) || a.monthIndex - b.monthIndex,
        )
        .map((point) => ({
          month: SEASON_MONTH_LABELS[point.monthIndex],
          season: point.season,
          value: point.value,
        })),
    [points],
  );

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          lineY(rows, {
            x: "month",
            y: "value",
            // `z` groups the paths AND supplies the colour value, so
            // each season is one continuous line in its own palette
            // slot. Without it every point joins into a single path.
            z: "season",
            points: true,
          }),
        ],
        scales: {
          x: {
            scale: () =>
              scalePoint<string>()
                .domain([...SEASON_MONTH_LABELS])
                .padding(0.04),
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              label: valueLabel,
              ticks: {
                format: (value: number) =>
                  Number.isInteger(value) ? String(value) : "",
              },
            },
          },
        },
      }),
    [rows, valueLabel],
  );

  return (
    <ChartSurface
      definition={definition}
      ariaLabel={ariaLabel}
      ariaDescription={ariaDescription}
      height={240}
      table={table}
    />
  );
}

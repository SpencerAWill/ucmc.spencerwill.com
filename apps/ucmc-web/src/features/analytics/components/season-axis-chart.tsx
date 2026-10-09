/**
 * A bar or line chart on the **season axis**: x is month-position
 * within the season, 0 = August, 11 = July.
 *
 * This is the one chart shape the whole area is built around. A
 * calendar-year axis cuts every club season in half and compares the
 * back of one against the front of the next, and a chart sorted by
 * calendar month puts January before August — which is backwards for
 * a season that opens in the autumn. Plotting the month INDEX from
 * `seasonOffsetOf` is what lets two seasons sit on one axis with no
 * special alignment logic: a partial current season simply stops
 * early, against the same point in prior ones.
 *
 * The month labels are a fixed array rather than formatted from a
 * date, because they are axis furniture with no year attached and
 * formatting them would need a locale and an instant that do not
 * exist here.
 */
import { barY, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";

import { ChartSurface } from "#/features/analytics/components/chart-surface";

/** 0 = August. Matches `seasonOffsetOf().monthIndex` exactly. */
export const SEASON_MONTH_LABELS = [
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
] as const;

export interface SeasonAxisPoint {
  monthIndex: number;
  /** Series identity — the category, not the colour. */
  series: string;
  value: number;
}

export function SeasonAxisChart({
  points,
  ariaLabel,
  ariaDescription,
  valueLabel,
  table,
}: {
  points: SeasonAxisPoint[];
  ariaLabel: string;
  ariaDescription?: string;
  valueLabel: string;
  table?: React.ReactNode;
}) {
  const rows = useMemo(
    () =>
      points.map((point) => ({
        month: SEASON_MONTH_LABELS[point.monthIndex],
        series: point.series,
        value: point.value,
      })),
    [points],
  );

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(rows, {
            x: "month",
            y: "value",
            // `color` carries series identity and also groups the
            // stack; the palette comes from the `--ts-chart-*` bridge
            // on `ChartSurface`, so no colour is named here.
            color: "series",
          }),
        ],
        scales: {
          x: {
            // A band scale with the domain stated, so empty months
            // keep their slot. Letting it infer from the data would
            // silently drop a month the club did nothing in and close
            // the gap — which is exactly the thing worth seeing.
            scale: () =>
              scaleBand<string>()
                .domain([...SEASON_MONTH_LABELS])
                .padding(0.18),
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              label: valueLabel,
              // Counts, so fractional ticks are meaningless — at this
              // club's volumes an auto-ticked axis would otherwise
              // offer "0.5 trips".
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

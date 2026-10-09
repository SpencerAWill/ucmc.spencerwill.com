/**
 * Daily usage as a share of each service's own cap — small multiples
 * on one shared 0–100% axis.
 *
 * **The shared axis is the whole point.** Each service has a different
 * ceiling (1,000 KV writes a day against 5,000,000 D1 rows), so
 * plotting raw quantities would give every panel its own scale and
 * make them impossible to compare. Normalising to share-of-cap and
 * pinning the domain to [0, 100] means a tall line is tall because the
 * service is close to its limit, not because its numbers are big.
 *
 * Because the domain is pinned rather than inferred, a flat line near
 * the floor is the correct, informative rendering for a service with
 * enormous headroom. Do not add `nice` or let the domain infer — that
 * would rescale each panel to its own data and silently undo this.
 */
import { areaY, defineChart, lineY } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { useMemo } from "react";

import { ChartSurface } from "#/features/analytics/components/chart-surface";
import {
  formatHeadroom,
  formatQuantity,
} from "#/features/analytics/lib/headroom";
import type { ServiceHeadroom } from "#/features/analytics/server/analytics-fns";

/** Share-of-cap, as a percentage. One row per captured period. */
interface UsagePoint {
  day: string;
  pct: number;
}

export function UsageSparklines({ services }: { services: ServiceHeadroom[] }) {
  const plottable = services.filter((service) => service.daily.length > 1);
  if (plottable.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plottable.map((service) => (
        <UsageSparkline key={service.service} service={service} />
      ))}
    </div>
  );
}

function UsageSparkline({ service }: { service: ServiceHeadroom }) {
  const points = useMemo<UsagePoint[]>(
    () =>
      service.daily.map((entry) => ({
        day: entry.day,
        pct: entry.fraction * 100,
      })),
    [service.daily],
  );

  // The definition captures `points`, so it is memoized on it — a new
  // definition identity is what tells the library to rebuild the
  // scene, and rebuilding it every render would throw away the layout
  // on each parent update.
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          areaY(points, { x: "day", y: "pct", fillOpacity: 0.15 }),
          lineY(points, { x: "day", y: "pct", strokeWidth: 2 }),
        ],
        scales: {
          // A point scale, not time: these are consecutive captured
          // periods and we want them evenly spaced. A gap in capture
          // should read as a gap in the record, which the day labels
          // in the table below carry — not as a wider segment here,
          // which would imply usage spread over the missing days.
          x: { scale: () => scalePoint<string>().padding(0.02) },
          y: { scale: () => scaleLinear().domain([0, 100]) },
        },
      }),
    [points],
  );

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium">{service.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          peak {formatHeadroom(service.fraction ?? 0)}
        </span>
      </div>
      <ChartSurface
        height={64}
        definition={definition}
        ariaLabel={`${service.label}: daily usage as a share of its free-tier limit`}
        ariaDescription={`Peaks at ${formatHeadroom(service.fraction ?? 0)} of ${formatQuantity(
          service.freeLimit ?? 0,
        )} ${service.unit} per ${service.limitPeriod}, on ${service.peakDay}. The vertical axis runs 0 to 100 percent of the limit for every service, so panels compare directly.`}
      />
    </div>
  );
}

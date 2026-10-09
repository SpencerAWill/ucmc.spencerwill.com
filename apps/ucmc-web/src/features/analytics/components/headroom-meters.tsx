/**
 * Free-tier headroom, worst first.
 *
 * Deliberately **not** a chart. Each row is one value against one
 * ceiling, which a bar renders exactly and a chart would only decorate
 * — and the artifact's survey put the share-bar-inside-a-row as the
 * highest value-per-pixel idea in it. Keeping these as HTML also means
 * the numbers are selectable, translatable and printable.
 *
 * Severity is carried by colour AND by the word beside it. Colour
 * alone fails SC 1.4.1, and these three fills are close in luminance.
 */
import {
  formatHeadroom,
  formatQuantity,
  headroomSeverity,
} from "#/features/analytics/lib/headroom";
import type { HeadroomSeverity } from "#/features/analytics/lib/headroom";
import type { ServiceHeadroom } from "#/features/analytics/server/analytics-fns";
import { cn } from "#/lib/utils";

const SEVERITY_LABEL: Record<HeadroomSeverity, string> = {
  healthy: "Healthy",
  watch: "Watch",
  "at-risk": "At risk",
};

const SEVERITY_FILL: Record<HeadroomSeverity, string> = {
  healthy: "bg-emerald-600 dark:bg-emerald-500",
  watch: "bg-amber-500",
  "at-risk": "bg-destructive",
};

export function HeadroomMeters({ services }: { services: ServiceHeadroom[] }) {
  return (
    <ul className="divide-y">
      {services.map((service) => (
        <HeadroomMeter key={service.service} service={service} />
      ))}
    </ul>
  );
}

function HeadroomMeter({ service }: { service: ServiceHeadroom }) {
  const { fraction, freeLimit, limitPeriod, peak, unit, label } = service;

  if (fraction === null || freeLimit === null) {
    return (
      <li className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-sm text-muted-foreground">
            No published limit
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          Peak {formatQuantity(peak)} {unit} per {limitPeriod}
        </p>
      </li>
    );
  }

  const severity = headroomSeverity(fraction);
  const pct = fraction * 100;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {formatHeadroom(fraction)}
        </span>
      </div>
      {/*
       * `progressbar` rather than the `meter` role: support for `meter`
       * is patchy, and the semantics that matter here (a current value
       * within a known range, with a text equivalent) are exactly what
       * progressbar carries. `aria-valuetext` is what a screen reader
       * actually announces, so it gets the sentence rather than the
       * bare percentage.
       */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(Math.round(pct), 100)}
        aria-valuetext={`${label}: ${formatHeadroom(fraction)} of the free tier used — ${SEVERITY_LABEL[severity]}`}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", SEVERITY_FILL[severity])}
          /*
           * A floor of 0.6% so a real-but-tiny reading is still a
           * visible sliver rather than nothing — the difference
           * between "measured, and minute" and "no data" has to stay
           * legible, and every other panel here is careful about it.
           * Capped at 100 so a blown cap fills the track instead of
           * overflowing it; the number beside it still reads over 100%.
           */
          style={{ width: `${Math.min(Math.max(pct, 0.6), 100)}%` }}
        />
      </div>
      <p className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground tabular-nums">
        <span>
          {formatQuantity(peak)} of {formatQuantity(freeLimit)} {unit} per{" "}
          {limitPeriod}
        </span>
        <span>{SEVERITY_LABEL[severity]}</span>
      </p>
    </li>
  );
}

/**
 * A share of a whole, as a bar with both numbers beside it.
 *
 * **Count first, percentage second** — issue #267's §3 is explicit
 * that percentages lie at this N: "coverage fell 8%" can be three
 * people. So the component takes the raw pair and renders both rather
 * than accepting a pre-computed share, which would make the honest
 * version optional.
 *
 * A zero denominator renders as "no members" rather than 0% or NaN:
 * dividing by it is the one case where a share has no meaning at all.
 */
import { cn } from "#/lib/utils";

export function CoverageBar({
  covered,
  total,
  coveredLabel,
  missingLabel,
  tone = "auto",
}: {
  covered: number;
  total: number;
  coveredLabel: string;
  missingLabel: string;
  /** `auto` colours by how bad the gap is; `neutral` never warns. */
  tone?: "auto" | "neutral";
}) {
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approved members to measure against yet.
      </p>
    );
  }

  const missing = Math.max(total - covered, 0);
  const pct = (covered / total) * 100;
  // Thresholds chosen for an obligation rather than a metric: anything
  // short of full coverage is a member who cannot legally participate,
  // so "fine" starts high and the amber band is narrow.
  const fill =
    tone === "neutral"
      ? "bg-primary"
      : pct >= 95
        ? "bg-emerald-600 dark:bg-emerald-500"
        : pct >= 80
          ? "bg-amber-500"
          : "bg-destructive";

  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-2xl font-semibold tabular-nums">
          {covered}
          <span className="text-muted-foreground"> / {total}</span>
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {pct.toFixed(0)}% {coveredLabel}
        </span>
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={covered}
        aria-valuetext={`${covered} of ${total} ${coveredLabel} — ${missing} ${missingLabel}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {missing === 0 ? (
          <>Everyone is {coveredLabel}.</>
        ) : (
          <>
            <b className="font-medium text-foreground">{missing}</b>{" "}
            {missingLabel}.
          </>
        )}
      </p>
    </div>
  );
}

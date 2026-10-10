/**
 * A headline number with its caveat underneath.
 *
 * The `meta` line is not decoration. At a few hundred members a bare
 * number is frequently misleading on its own — "63 active" means
 * nothing without "of 81 approved, in the last 30 days" — and issue
 * #267's §3 is explicit that percentages lie at this N. So the slot is
 * part of the component rather than something each caller remembers.
 */
import { Card } from "#/components/ui/card";
import { cn } from "#/lib/utils";

export function StatTile({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: React.ReactNode;
  /**
   * Colours the VALUE only, and only where the number itself carries a
   * status (headroom, overdue counts). Never the sole signal — the
   * meta line says it in words too, per SC 1.4.1.
   */
  tone?: "neutral" | "warn" | "crit";
}) {
  return (
    <Card className="gap-0 p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-500",
          tone === "crit" && "text-destructive",
        )}
      >
        {value}
      </span>
      {meta ? (
        <span className="mt-1 text-sm text-muted-foreground">{meta}</span>
      ) : null}
    </Card>
  );
}

/** The row those tiles sit in — one grid, so every page's band matches. */
export function StatTileRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

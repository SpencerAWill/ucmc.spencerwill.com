/**
 * The exception list on the root dashboard.
 *
 * Renders what `buildAttention` derived, severity-chipped. The chip
 * carries the severity in WORDS as well as colour — the three fills
 * are close in luminance and colour alone fails SC 1.4.1.
 */
import { Link } from "@tanstack/react-router";

import type {
  AttentionItem,
  AttentionSeverity,
} from "#/features/analytics/lib/attention";
import { cn } from "#/lib/utils";

const CHIP_LABEL: Record<AttentionSeverity, string> = {
  "act-now": "Act now",
  watch: "Watch",
  clear: "Clear",
};

const CHIP_CLASS: Record<AttentionSeverity, string> = {
  "act-now": "bg-destructive/10 text-destructive",
  watch:
    "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  clear:
    "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
};

export function AttentionPanel({
  items,
  anyVisible,
  isPending,
}: {
  items: AttentionItem[];
  /**
   * Whether this viewer could see ANY of the underlying datasets.
   *
   * An empty list means two very different things and the panel must
   * not conflate them: nothing is wrong, or nothing was visible. A
   * viewer holding only `analytics:view` would otherwise be told the
   * club is in perfect shape on the strength of having read nothing.
   */
  anyVisible: boolean;
  /**
   * Whether any dataset is still in flight.
   *
   * **A third state, and it has to be distinct from the other two.**
   * An exception list that is empty because it has not loaded yet
   * looks exactly like one that is empty because nothing is wrong —
   * so without this an officer gets a flash of "all clear" before nine
   * uncovered waivers appear. Same "no data is not zero" rule the
   * panels enforce everywhere else on this page, applied to the one
   * surface where getting it wrong is actively reassuring.
   */
  isPending: boolean;
}) {
  if (isPending) {
    return <p className="py-4 text-sm text-muted-foreground">Checking…</p>;
  }

  if (!anyVisible) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        You don’t have access to any of the underlying data, so there is nothing
        to check here. Ask a system admin if you expected to see gear, waiver,
        membership or platform figures.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Nothing needs attention in the data you can see.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
        >
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tracking-wide uppercase",
              CHIP_CLASS[item.severity],
            )}
          >
            {CHIP_LABEL[item.severity]}
          </span>
          <span className="min-w-0 flex-1 text-sm">{item.message}</span>
          <Link
            to={item.href}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            {item.linkLabel} →
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A ranked list with a faint share-bar behind each row.
 *
 * The highest value-per-pixel idea in the artifact's prior-art survey
 * (Plausible's ranked panels), and it costs no chart: the bar is a
 * background on the row itself, so the label and the number stay
 * ordinary selectable text sitting on top of it.
 *
 * The bar is scaled to the LARGEST row, not to the total. These lists
 * are top-N slices of a longer tail, so a share-of-total bar would be
 * a share of a total that is not shown — and every row would be a
 * sliver. Relative-to-the-leader is the comparison the eye actually
 * makes down a ranked list.
 */
export function RankedBars({
  rows,
}: {
  rows: {
    key: string;
    label: string;
    sublabel?: string | null;
    value: number;
  }[];
}) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0);
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.key} className="relative isolate">
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-primary/10"
            style={{ width: max === 0 ? "0%" : `${(row.value / max) * 100}%` }}
          />
          <div className="flex items-baseline justify-between gap-4 px-2 py-1.5 text-sm">
            <span className="truncate">
              {row.label}
              {row.sublabel ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.sublabel}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {row.value}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The strip of numbers under a profile header.
 *
 * Two columns on a phone, four from `sm` — a four-across strip at
 * 390px gives each figure about 80px, which wraps "Gear loans" onto
 * two lines and leaves the numbers no longer legible as a row.
 *
 * Only tiles with something behind them are rendered. A strip padded
 * out with zeros reads as a member who has done nothing, when the
 * truth is usually that the club has not recorded it yet — trip
 * counts in particular have no data source at all until sign-ups
 * move into the site (#257).
 */
import { cn } from "#/lib/utils";

export interface ProfileStat {
  label: string;
  value: number;
}

export function ProfileStats({
  stats,
  className,
}: {
  stats: ProfileStat[];
  className?: string;
}) {
  if (stats.length === 0) {
    return null;
  }

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
        // The column count follows the number of tiles rather than
        // being fixed at four: a fixed four-column track leaves an
        // empty cell showing the grid's own border colour, which
        // reads as a tile that failed to load.
        "sm:[grid-template-columns:var(--profile-stat-cols)]",
        className,
      )}
      style={
        {
          "--profile-stat-cols": `repeat(${stats.length}, minmax(0, 1fr))`,
        } as React.CSSProperties
      }
    >
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn(
            "bg-card px-4 py-3",
            // Two columns on a phone, so an odd number of tiles
            // leaves a hole in the last row that renders as the
            // grid's border colour. The final tile spans the row
            // instead — same fix as the desktop track above, which
            // is why neither grid ever shows an empty cell.
            i === stats.length - 1 && stats.length % 2 === 1
              ? "max-sm:col-span-2"
              : null,
          )}
        >
          <dd className="text-xl font-semibold tabular-nums">{stat.value}</dd>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

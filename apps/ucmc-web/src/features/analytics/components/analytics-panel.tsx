/**
 * One panel on an analytics page: a titled card with an optional note
 * in the corner and a body.
 *
 * The note is for the caveat that makes the number honest — the
 * denominator, the window, the fact that a figure is a peak rather
 * than a mean. Issue #267's §3 is the reason it is a first-class slot
 * rather than something each panel improvises: at a few hundred
 * members the caveat is frequently more load-bearing than the number.
 */
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { cn } from "#/lib/utils";

export function AnalyticsPanel({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {note ? (
            <span className="text-xs text-muted-foreground">{note}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * What a panel renders when its query came back with nothing.
 *
 * **"No data yet" and "zero" are different claims**, and conflating
 * them is the specific failure the platform page is careful about: a
 * gap in a cost series because nothing was recorded must not read as a
 * month that cost nothing. Panels use this for the first; they render
 * the actual zero for the second.
 */
export function AnalyticsPanelEmpty({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}

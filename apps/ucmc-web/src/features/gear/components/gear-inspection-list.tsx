/**
 * The inspection history list, shared by the two surfaces that show one:
 * a coded piece's detail page and a counted model's batch log. An
 * inspection reads the same either way — result, date, who, notes — so
 * the renderer is one component rather than a near-copy per layer.
 */
import { Badge } from "#/components/ui/badge";
import type {
  GearInspectionResultValue,
  GearInspectionSummary,
} from "#/features/gear/server/gear-fns";
import { formatDate } from "#/lib/date-format";

const RESULT_LABEL: Record<GearInspectionResultValue, string> = {
  pass: "Pass",
  fail: "Fail",
  advisory: "Advisory",
};

const RESULT_VARIANT: Record<
  GearInspectionResultValue,
  "secondary" | "destructive" | "outline"
> = {
  pass: "secondary",
  fail: "destructive",
  advisory: "outline",
};

export function GearInspectionList({
  inspections,
  isLoading,
  emptyMessage = "No inspections recorded yet.",
}: {
  inspections: GearInspectionSummary[];
  isLoading: boolean;
  emptyMessage?: string;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (inspections.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-y">
      {inspections.map((entry) => (
        <InspectionRow key={entry.publicId} entry={entry} />
      ))}
    </ul>
  );
}

function InspectionRow({ entry }: { entry: GearInspectionSummary }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={RESULT_VARIANT[entry.result]}>
            {RESULT_LABEL[entry.result]}
          </Badge>
          <span className="text-sm font-medium">
            {formatDate(entry.inspectedAt)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          by {entry.inspectorName ?? "Unknown"}
        </span>
      </div>
      {entry.notes ? (
        <p className="mt-1.5 text-sm whitespace-pre-wrap text-muted-foreground">
          {entry.notes}
        </p>
      ) : null}
    </li>
  );
}

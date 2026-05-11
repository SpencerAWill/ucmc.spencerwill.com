import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { gearInspectionsQueryOptions } from "#/features/gear/api/queries";
import { GearInspectionFormDialog } from "#/features/gear/components/gear-inspection-form-dialog";
import type {
  GearInspectionResultValue,
  GearInspectionSummary,
  GearSummary,
} from "#/features/gear/server/gear-fns";

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

export function GearInspectionsSection({
  gear,
  canManage,
}: {
  gear: GearSummary;
  canManage: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading } = useQuery(
    gearInspectionsQueryOptions(gear.publicId),
  );
  const inspections = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          Inspection log
        </CardTitle>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
            <Plus className="size-4" />
            Log inspection
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : inspections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No inspections recorded yet.
          </p>
        ) : (
          <ul className="divide-y">
            {inspections.map((entry) => (
              <InspectionRow key={entry.publicId} entry={entry} />
            ))}
          </ul>
        )}
      </CardContent>
      {canManage ? (
        <GearInspectionFormDialog
          gear={gear}
          open={logOpen}
          onOpenChange={setLogOpen}
        />
      ) : null}
    </Card>
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
            {format(entry.inspectedAt, "MMM d, yyyy")}
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

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { gearInspectionsQueryOptions } from "#/features/gear/api/queries";
import { GearInspectionFormDialog } from "#/features/gear/components/gear-inspection-form-dialog";
import { GearInspectionList } from "#/features/gear/components/gear-inspection-list";
import type { GearSummary } from "#/features/gear/server/gear-fns";

export function GearInspectionsSection({
  gear,
  canInspect,
}: {
  gear: GearSummary;
  /** Holder of `gear:inspect` or `gear:manage` — the inspection log is
   *  delegable on its own, so it does NOT follow full inventory CRUD. */
  canInspect: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading } = useQuery(
    gearInspectionsQueryOptions(gear.publicId),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          Inspection log
        </CardTitle>
        {canInspect ? (
          <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
            <Plus className="size-4" />
            Log inspection
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <GearInspectionList inspections={data ?? []} isLoading={isLoading} />
      </CardContent>
      {canInspect ? (
        <GearInspectionFormDialog
          target={{ kind: "item", publicId: gear.publicId }}
          label={gear.code ?? gear.name}
          open={logOpen}
          onOpenChange={setLogOpen}
        />
      ) : null}
    </Card>
  );
}

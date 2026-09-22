/**
 * Batch inspections for counted gear, for anyone holding `gear:inspect`.
 *
 * Counted models are inspected as a whole — "looked over all the draws"
 * — and until now the only door to that was the Models dialog, which is
 * `gear:manage`. That coupled a fuzzing sling to the grant that can also
 * retire gear and bulk-import inventory, which is exactly what
 * `gear:inspect` was seeded to break: a trip leader could log a failed
 * rope and not a failed sling, for no reason anyone could defend.
 *
 * So this is a worklist, not a catalog editor. It lists counted models
 * stalest-first with their two safety clocks, and the only write it
 * offers is the append-only inspection every officer on the trip roster
 * is trusted with. Managers keep the same log on the Models dialog,
 * where they are already editing the product.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Item, ItemActions, ItemContent } from "#/components/ui/item";
import {
  countedModelsForInspectionQueryOptions,
  gearModelInspectionsQueryOptions,
} from "#/features/gear/api/queries";
import { GearInspectionFormDialog } from "#/features/gear/components/gear-inspection-form-dialog";
import { GearInspectionList } from "#/features/gear/components/gear-inspection-list";
import { GearModelSafetyBadges } from "#/features/gear/components/gear-model-safety-badges";
import type { CountedModelForInspectionDto } from "#/features/gear/server/gear-fns";
import { formatDate } from "#/lib/date-format";

function modelLabel(model: CountedModelForInspectionDto): string {
  return model.manufacturer
    ? `${model.manufacturer} ${model.name}`
    : model.name;
}

export function GearBatchInspectionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<CountedModelForInspectionDto | null>(
    null,
  );
  const { data, isLoading } = useQuery(
    countedModelsForInspectionQueryOptions(),
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelected(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setSelected(null)}
                aria-label="Back to counted gear"
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : (
              <ClipboardCheck className="size-4 text-muted-foreground" />
            )}
            {selected ? modelLabel(selected) : "Batch inspections"}
          </DialogTitle>
          <DialogDescription>
            Gear the cave counts rather than labels — draws, slings, anything
            handed out by the handful. The whole batch is checked at once,
            because there are no individual pieces to check.
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <ModelPane model={selected} />
        ) : (
          <ListPane
            models={data ?? []}
            isLoading={isLoading}
            onSelect={setSelected}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListPane({
  models,
  isLoading,
  onSelect,
}: {
  models: CountedModelForInspectionDto[];
  isLoading: boolean;
  onSelect: (model: CountedModelForInspectionDto) => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (models.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No counted gear yet.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="max-h-[55dvh] space-y-2 overflow-y-auto">
      {models.map((model) => (
        <li key={model.publicId}>
          <Item variant="outline" size="sm">
            <ItemContent>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{modelLabel(model)}</span>
                <GearModelSafetyBadges model={model} />
              </div>
              <p className="text-xs text-muted-foreground">
                {model.typeName} ·{" "}
                {model.lastInspectedAtMs === null
                  ? "never inspected"
                  : `last checked ${formatDate(
                      Temporal.Instant.fromEpochMilliseconds(
                        model.lastInspectedAtMs,
                      ),
                    )}`}
              </p>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelect(model)}
              >
                Open
              </Button>
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  );
}

function ModelPane({ model }: { model: CountedModelForInspectionDto }) {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading } = useQuery(
    gearModelInspectionsQueryOptions(model.publicId),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          The whole batch, checked at once.
        </p>
        <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
          <Plus className="size-4" />
          Log inspection
        </Button>
      </div>
      <div className="max-h-[45dvh] overflow-y-auto">
        <GearInspectionList inspections={data ?? []} isLoading={isLoading} />
      </div>
      <GearInspectionFormDialog
        target={{ kind: "model", publicId: model.publicId }}
        label={modelLabel(model)}
        open={logOpen}
        onOpenChange={setLogOpen}
      />
    </div>
  );
}

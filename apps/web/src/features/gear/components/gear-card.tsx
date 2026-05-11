import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Edit, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import type { GearSummary } from "#/features/gear/server/gear-fns";

const CONDITION_LABEL: Record<GearSummary["condition"], string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

const CONDITION_VARIANT: Record<
  GearSummary["condition"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  serviceable: "secondary",
  needs_repair: "outline",
  missing: "outline",
  lost: "destructive",
};

export function GearCard({
  gear,
  canManage,
  onEdit,
  onRetire,
  onUnretire,
}: {
  gear: GearSummary;
  canManage: boolean;
  onEdit: () => void;
  onRetire: () => void;
  onUnretire: () => void;
}) {
  const isRetired = gear.lifecycle === "retired";
  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <CodeBadge code={gear.code} retired={isRetired} />
          <div className="space-y-1">
            <CardTitle className="text-base">
              <Link
                to="/gear/$publicId"
                params={{ publicId: gear.publicId }}
                className="underline-offset-4 hover:underline"
              >
                {gear.type.name}
              </Link>
              {gear.description ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  {gear.description}
                </span>
              ) : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={CONDITION_VARIANT[gear.condition]}>
                {CONDITION_LABEL[gear.condition]}
              </Badge>
              {isRetired ? <Badge variant="outline">Retired</Badge> : null}
              {gear.tags.map((tag) => (
                <Badge key={tag.publicId} variant="outline">
                  #{tag.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit className="size-4" />
              <span className="sr-only">Edit</span>
            </Button>
            {isRetired ? (
              <Button variant="ghost" size="sm" onClick={onUnretire}>
                <RotateCcw className="size-4" />
                <span className="sr-only">Unretire</span>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onRetire}>
                <Trash2 className="size-4" />
                <span className="sr-only">Retire</span>
              </Button>
            )}
          </div>
        ) : null}
      </CardHeader>
      {gear.acquiredAt || gear.acquisitionCostCents !== null ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {gear.acquiredAt ? (
            <span>Acquired {format(gear.acquiredAt, "MMM d, yyyy")}</span>
          ) : null}
          {gear.acquiredAt && gear.acquisitionCostCents !== null ? (
            <span className="mx-2">·</span>
          ) : null}
          {gear.acquisitionCostCents !== null ? (
            <span>${(gear.acquisitionCostCents / 100).toFixed(2)}</span>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function CodeBadge({
  code,
  retired,
}: {
  code: string | null;
  retired: boolean;
}) {
  if (code === null) {
    return (
      <span className="inline-flex h-9 min-w-[3.5rem] items-center justify-center rounded border border-dashed border-muted-foreground/40 px-2 text-xs text-muted-foreground">
        no code
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-9 min-w-[3.5rem] items-center justify-center rounded border px-2 font-mono text-sm font-semibold ${
        retired
          ? "border-muted text-muted-foreground"
          : "border-primary/30 bg-primary/10 text-primary"
      }`}
    >
      {code}
    </span>
  );
}

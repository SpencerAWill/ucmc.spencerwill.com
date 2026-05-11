import { format } from "date-fns";

import { Badge } from "#/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import type { GearDetail } from "#/features/gear/server/gear-fns";

const CONDITION_LABEL: Record<GearDetail["condition"], string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

export function GearDetailCard({
  gear,
  canManage,
}: {
  gear: GearDetail;
  /** When false, the acquisition cost is omitted. Approved members can
   *  see everything else (notes, condition, dates), but cost is
   *  officer-only since it leaks budget detail. */
  canManage: boolean;
}) {
  const isRetired = gear.lifecycle === "retired";
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {gear.code ? (
              <span className="inline-flex h-10 items-center justify-center rounded border border-primary/30 bg-primary/10 px-3 font-mono text-lg font-semibold text-primary">
                {gear.code}
              </span>
            ) : (
              <span className="inline-flex h-10 items-center justify-center rounded border border-dashed border-muted-foreground/40 px-3 text-sm text-muted-foreground">
                no code
              </span>
            )}
            <div>
              <CardTitle>{gear.type.name}</CardTitle>
              {gear.description ? (
                <CardDescription>{gear.description}</CardDescription>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={isRetired ? "outline" : "secondary"}>
              {isRetired ? "Retired" : "Active"}
            </Badge>
            <Badge variant="outline">{CONDITION_LABEL[gear.condition]}</Badge>
            {gear.tags.map((tag) => (
              <Badge key={tag.publicId} variant="outline">
                #{tag.name}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {gear.acquiredAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Acquired</dt>
              <dd>{format(gear.acquiredAt, "MMM d, yyyy")}</dd>
            </div>
          ) : null}
          {canManage && gear.acquisitionCostCents !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">Cost</dt>
              <dd>${(gear.acquisitionCostCents / 100).toFixed(2)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Added</dt>
            <dd>{format(gear.createdAt, "MMM d, yyyy")}</dd>
          </div>
          {isRetired && gear.retiredAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Retired</dt>
              <dd>{format(gear.retiredAt, "MMM d, yyyy")}</dd>
            </div>
          ) : null}
        </dl>
        {isRetired && gear.retiredReason ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Reason:</span> {gear.retiredReason}
          </p>
        ) : null}
        {gear.notesMarkdown ? (
          <div className="rounded border bg-background p-3">
            <MarkdownContent>{gear.notesMarkdown}</MarkdownContent>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Edit, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "#/components/ui/item";
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

// Static placeholder until per-gear thumbnails land. Swap in
// `gear.thumbnailKey`-backed R2 URLs (or a private-bucket `<img>` via
// the worker) when that feature ships — the slot is already here.
const GEAR_PLACEHOLDER_SRC = "/gear-placeholder.svg";

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
  // Footer only renders when there's something to show. Cost is gated:
  // approved members see acquired-date but not the dollar amount.
  const showFooter =
    gear.acquiredAt !== null ||
    (canManage && gear.acquisitionCostCents !== null);
  return (
    <Item variant="outline" size="default" className="items-stretch">
      {/* Fixed-width media slot that stretches to the item's full
       * height. Override the default `size-10` square so the
       * placeholder (and eventually real thumbnails) read as a proper
       * preview rather than a tiny avatar. `aspect-square` on the
       * inner img keeps the thumb from going wider than tall when the
       * card is short. */}
      <ItemMedia
        variant="image"
        className="size-auto h-auto w-24 self-stretch sm:w-28"
      >
        <img
          src={GEAR_PLACEHOLDER_SRC}
          alt=""
          className="aspect-square h-full w-full object-cover"
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <CodeBadge code={gear.code} retired={isRetired} />
          <Link
            to="/gear/$publicId"
            params={{ publicId: gear.publicId }}
            className="underline-offset-4 hover:underline"
          >
            {gear.type.name}
          </Link>
        </ItemTitle>
        {gear.description ? (
          <ItemDescription>{gear.description}</ItemDescription>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant={CONDITION_VARIANT[gear.condition]}>
            {CONDITION_LABEL[gear.condition]}
          </Badge>
          {isRetired ? <Badge variant="outline">Retired</Badge> : null}
        </div>
        {gear.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {gear.tags.map((tag) => (
              <Badge key={tag.publicId} variant="outline">
                #{tag.name}
              </Badge>
            ))}
          </div>
        ) : null}
      </ItemContent>
      {canManage ? (
        <ItemActions>
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
        </ItemActions>
      ) : null}
      {showFooter ? (
        <ItemFooter>
          <div className="text-xs text-muted-foreground">
            {gear.acquiredAt ? (
              <span>Acquired {format(gear.acquiredAt, "MMM d, yyyy")}</span>
            ) : null}
            {gear.acquiredAt &&
            canManage &&
            gear.acquisitionCostCents !== null ? (
              <span className="mx-2">·</span>
            ) : null}
            {canManage && gear.acquisitionCostCents !== null ? (
              <span>${(gear.acquisitionCostCents / 100).toFixed(2)}</span>
            ) : null}
          </div>
        </ItemFooter>
      ) : null}
    </Item>
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
      <span className="inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded border border-dashed border-muted-foreground/40 px-2 text-xs text-muted-foreground">
        no code
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded border px-2 font-mono text-sm font-semibold ${
        retired
          ? "border-muted text-muted-foreground"
          : "border-primary/30 bg-primary/10 text-primary"
      }`}
    >
      {code}
    </span>
  );
}

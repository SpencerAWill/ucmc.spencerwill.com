import { formatDate } from "#/lib/date-format";

import { Badge } from "#/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { formatAttributeValue } from "#/features/gear/lib/attributes";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { GearDetail } from "#/features/gear/server/gear-fns";
import {
  CONDITION_LABEL,
  CONDITION_VARIANT,
  STATUS_LABEL,
  STATUS_VARIANT,
  WHEREABOUTS_LABEL,
  WHEREABOUTS_VARIANT,
} from "#/features/gear/lib/labels";

// Mirrors the placeholder used on the list page so the detail view
// matches visually. Swap for a real per-gear thumbnail key when that
// feature lands.
const GEAR_PLACEHOLDER_SRC = "/gear-placeholder.svg";

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
  const isRetired = gear.status === "retired";
  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-md border bg-muted sm:w-40">
          <img
            src={
              gear.thumbnailKey
                ? gearThumbnailUrlFor(gear.thumbnailKey)
                : GEAR_PLACEHOLDER_SRC
            }
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex-1 space-y-2">
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
            <Badge variant={STATUS_VARIANT[gear.status]}>
              {STATUS_LABEL[gear.status]}
            </Badge>
            <Badge variant={CONDITION_VARIANT[gear.condition]}>
              {CONDITION_LABEL[gear.condition]}
            </Badge>
            {/* Whereabouts only reads as news when the item isn't where
                it should be — "In the cave" on every card is noise. */}
            {gear.whereabouts !== "cave" ? (
              <Badge variant={WHEREABOUTS_VARIANT[gear.whereabouts]}>
                {WHEREABOUTS_LABEL[gear.whereabouts]}
              </Badge>
            ) : null}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {gear.model.manufacturer ? (
            <div>
              <dt className="text-xs text-muted-foreground">Manufacturer</dt>
              <dd>{gear.model.manufacturer}</dd>
            </div>
          ) : null}
          {gear.serialNumber ? (
            <div>
              <dt className="text-xs text-muted-foreground">Serial</dt>
              <dd className="font-mono text-xs">{gear.serialNumber}</dd>
            </div>
          ) : null}
          {/* Officer-defined answers sit in the same grid as the
           * built-in fields on purpose: to a member reading a harness
           * page, "Size M" is not a different class of fact from
           * "Manufacturer Petzl", and a separate section would imply it
           * was. Model- and item-level answers are likewise not
           * distinguished — nobody reading the page cares which level
           * the answer was typed at. */}
          {gear.attributes.map((attribute) => {
            const formatted = formatAttributeValue(attribute);
            return formatted === null ? null : (
              <div key={attribute.defPublicId}>
                <dt className="text-xs text-muted-foreground">
                  {attribute.label}
                </dt>
                <dd>{formatted}</dd>
              </div>
            );
          })}
          {gear.acquiredAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Acquired</dt>
              <dd>{formatDate(gear.acquiredAt)}</dd>
            </div>
          ) : null}
          {canManage && gear.acquisitionCostCents !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">Cost</dt>
              <dd>${(gear.acquisitionCostCents / 100).toFixed(2)}</dd>
            </div>
          ) : null}
          {canManage && gear.model.msrpCents !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">MSRP</dt>
              <dd>${(gear.model.msrpCents / 100).toFixed(2)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Added</dt>
            <dd>{formatDate(gear.createdAt)}</dd>
          </div>
          {isRetired && gear.deactivatedAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Retired</dt>
              <dd>{formatDate(gear.deactivatedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {gear.holdReason !== null ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Held:</span> {gear.holdReason}
            {gear.holdEndsAt !== null
              ? ` — free again ${formatDate(gear.holdEndsAt)}`
              : ""}
          </p>
        ) : null}
        {isRetired && gear.deactivatedReason ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Reason:</span>{" "}
            {gear.deactivatedReason}
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

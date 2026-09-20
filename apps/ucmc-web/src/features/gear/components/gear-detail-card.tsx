import { formatDate, formatRelative } from "#/lib/date-format";

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
import {
  INSPECTION_STATUS_LABEL,
  SERVICE_LIFE_STATUS_LABEL,
  isSafetyFlag,
} from "#/features/gear/lib/safety";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { GearDetail } from "#/features/gear/server/gear-fns";
import { GearTagChip } from "#/features/gear/components/gear-tag-chip";
import {
  CONDITION_LABEL,
  CONDITION_VARIANT,
  STATUS_LABEL,
  WHEREABOUTS_LABEL,
  WHEREABOUTS_VARIANT,
  availabilityBadge,
  isOverdue,
  isTerminalStatus,
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
  const isInactive = isTerminalStatus(gear.status);
  const availability = availabilityBadge(gear);
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
              {gear.name ? (
                <CardDescription>{gear.name}</CardDescription>
              ) : null}
            </div>
          </div>
          {/* Availability leads, as it does on every other gear
              surface. The page used to open with Active + Serviceable
              and nothing else, so a harness out on loan, one held for
              Saturday and one nobody could find all read the same —
              while the list card one click back said exactly which. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={availability.variant}>{availability.label}</Badge>
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
                <GearTagChip key={tag.publicId} name={tag.name} />
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
          {/* Gated on the whole terminal set, not on `retired` alone:
              an item recorded as lost or disposed has a deactivation
              date and a reason too, and neither rendered anywhere. */}
          {isInactive && gear.deactivatedAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">
                {STATUS_LABEL[gear.status]}
              </dt>
              <dd>{formatDate(gear.deactivatedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {/* The two derived safety clocks. Only the states worth acting
         * on get a line — "Inspection current" on every page would be
         * noise, and the quiet majority is exactly that.
         *
         * Outline, never solid destructive. Neither clock blocks
         * checkout: an overdue cadence means nobody has *looked*, which
         * is a job for the cave rather than a refusal at the desk.
         * Wearing the same solid red as `Unsafe` — the one hard block
         * with no override — said the opposite, and made the red that
         * does mean "stop" mean less. The urgent states keep destructive
         * *text* so the hierarchy survives. */}
        {isSafetyFlag(gear.inspection.status) ||
        isSafetyFlag(gear.serviceLife.status) ? (
          <div className="flex flex-wrap gap-2">
            {isSafetyFlag(gear.inspection.status) ? (
              <Badge
                variant="outline"
                className={
                  gear.inspection.status === "overdue" ||
                  gear.inspection.status === "never"
                    ? "border-destructive/40 text-destructive"
                    : undefined
                }
              >
                {INSPECTION_STATUS_LABEL[gear.inspection.status]}
                {gear.inspection.dueAt !== null
                  ? ` — due ${formatDate(gear.inspection.dueAt)}`
                  : ""}
              </Badge>
            ) : null}
            {isSafetyFlag(gear.serviceLife.status) ? (
              <Badge
                variant="outline"
                className={
                  gear.serviceLife.status === "expired"
                    ? "border-destructive/40 text-destructive"
                    : undefined
                }
              >
                {SERVICE_LIFE_STATUS_LABEL[gear.serviceLife.status]}
                {gear.serviceLife.expiresAt !== null
                  ? ` — ${formatDate(gear.serviceLife.expiresAt)}`
                  : ""}
              </Badge>
            ) : null}
          </div>
        ) : null}
        {/* Who has it and when it's back. The page carried `currentLoan`
            and rendered none of it, so the deepest view of a piece was
            the one view that wouldn't say it was out. The borrower's
            name is server-gated: officers and the borrower themselves
            get it, everyone else sees that it's out and nothing more. */}
        {gear.currentLoan !== null ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">
              {isOverdue(gear.currentLoan.dueAt) ? "Overdue" : "On loan"}
            </span>
            {gear.currentLoan.memberFullName
              ? ` to ${gear.currentLoan.memberFullName}`
              : ""}
            {isOverdue(gear.currentLoan.dueAt)
              ? ` — was due ${formatRelative(gear.currentLoan.dueAt)}`
              : ` — back ${formatDate(gear.currentLoan.dueAt)}`}
          </p>
        ) : null}
        {/* No "Held:" label in front of the reason. Officers write these
            as sentences starting with the word Held — "Held for the Red
            River trip" — so a label produced "Held: Held for…". The
            reason leads and the badge above already says it's on hold. */}
        {gear.holdReason !== null ? (
          <p className="text-sm text-muted-foreground">
            {gear.holdReason}
            {gear.holdEndsAt !== null
              ? ` — free again ${formatDate(gear.holdEndsAt)}`
              : ""}
          </p>
        ) : null}
        {/* Where it was last seen and when. Both are stored, both come
            from a sweep, and neither rendered — so a missing harness
            said "Missing" and refused to say since when, which is the
            first thing anybody asks. */}
        {gear.whereabouts !== "cave" &&
        (gear.whereaboutsAsOf !== null || gear.whereaboutsNote !== null) ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">
              {WHEREABOUTS_LABEL[gear.whereabouts]}
            </span>
            {gear.whereaboutsAsOf !== null
              ? ` since ${formatDate(gear.whereaboutsAsOf)}`
              : ""}
            {gear.whereaboutsNote ? ` — ${gear.whereaboutsNote}` : ""}
          </p>
        ) : null}
        {isInactive && gear.deactivatedReason ? (
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

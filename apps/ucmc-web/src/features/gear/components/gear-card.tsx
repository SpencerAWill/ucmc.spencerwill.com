import { Link } from "@tanstack/react-router";
import { Edit, MoreVertical, RotateCcw, Tag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { cn } from "#/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { AddToCartButton } from "#/features/gear/components/add-to-cart-button";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
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

// Falls back to the static placeholder SVG when the gear row has no
// uploaded thumbnail. Per-gear keys live under `gear/<gearId>/...` and
// resolve through `gearThumbnailUrlFor` (CDN domain in prod,
// `/api/gear-thumbnails/...` in local dev).
const GEAR_PLACEHOLDER_SRC = "/gear-placeholder.svg";

/**
 * List-card view of a single gear row. Layout:
 *
 *   ┌────┐  Description (primary heading)             [🏷 N] [⋮]
 *   │img │  Type · Code
 *   │img │  [Condition] [Retired?]
 *   └────┘
 *
 * Card height is intentionally constant regardless of tag count — tags
 * live behind a hover/tap popover in the actions column, not in the
 * content body. The popover trigger doubles as a count badge.
 *
 * Uses a CSS grid (not the `Item` primitive) because grid naturally
 * stretches every cell to row height — the only reliable way to make
 * the thumbnail fill the card's full vertical space regardless of
 * content-column height.
 *
 * Acquisition date and cost are intentionally absent here — they live
 * on the detail page so the list stays scannable.
 */
export function GearCard({
  gear,
  canManage,
  selected,
  onToggleSelect,
  onEdit,
  onRetire,
  onUnretire,
}: {
  gear: GearSummary;
  canManage: boolean;
  /** When provided, renders a checkbox overlay on the thumbnail. The
   *  Card gains a `ring-primary` border in the selected state so the
   *  whole row reads as picked even when the checkbox is offscreen. */
  selected?: boolean;
  onToggleSelect?: () => void;
  onEdit: () => void;
  onRetire: () => void;
  onUnretire: () => void;
}) {
  const isRetired = gear.lifecycle === "retired";
  const subtitleParts = [gear.type.name, gear.code].filter(
    (p): p is string => p !== null,
  );

  return (
    <Card
      className={cn(
        "overflow-hidden p-0 transition-shadow",
        selected ? "ring-2 ring-primary" : undefined,
      )}
    >
      <div className="grid grid-cols-[5rem_1fr_auto] sm:grid-cols-[7rem_1fr_auto]">
        <div className="relative">
          <Link
            to="/gear/$publicId"
            params={{ publicId: gear.publicId }}
            className="block h-full w-full bg-muted"
            aria-label={`Open ${gear.description}`}
          >
            <img
              src={
                gear.thumbnailKey
                  ? gearThumbnailUrlFor(gear.thumbnailKey)
                  : GEAR_PLACEHOLDER_SRC
              }
              alt=""
              className="h-full w-full object-cover"
            />
          </Link>
          {onToggleSelect && canManage ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect();
              }}
              className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm transition-opacity hover:bg-background"
              aria-label={`Select ${gear.code ?? gear.description}`}
            >
              <Checkbox
                checked={selected}
                className="pointer-events-none size-4"
                tabIndex={-1}
                aria-hidden
              />
            </button>
          ) : null}
        </div>

        {/* Content cell */}
        <div className="min-w-0 space-y-1 p-3 sm:p-4">
          <h3 className="text-base leading-snug font-medium">
            <Link
              to="/gear/$publicId"
              params={{ publicId: gear.publicId }}
              className="line-clamp-2 underline-offset-4 hover:underline"
            >
              {gear.description}
            </Link>
          </h3>
          {subtitleParts.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {subtitleParts.map((part, i) => (
                <span key={i}>
                  {i > 0 ? <span className="mx-1.5">·</span> : null}
                  {part === gear.code ? (
                    <span className="font-mono">{part}</span>
                  ) : (
                    part
                  )}
                </span>
              ))}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant={CONDITION_VARIANT[gear.condition]}>
              {CONDITION_LABEL[gear.condition]}
            </Badge>
            {isRetired ? <Badge variant="outline">Retired</Badge> : null}
          </div>
        </div>

        {/* Actions cell — top-aligned so icons don't drift to the
         * vertical centre on tall cards. The tag-count popover sits
         * next to the action overflow so card height stays constant
         * regardless of how many tags this gear carries. The cell
         * always renders so the grid columns stay stable even when
         * neither tags nor manage affordances are visible. */}
        <div className="flex items-start gap-0 p-2 sm:p-3">
          <AddToCartButton
            publicId={gear.publicId}
            code={gear.code}
            lifecycle={gear.lifecycle}
          />
          {gear.tags.length > 0 ? <TagsPopover tags={gear.tags} /> : null}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${gear.code ?? gear.description}`}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Edit className="size-4" />
                  Edit
                </DropdownMenuItem>
                {isRetired ? (
                  <DropdownMenuItem onSelect={onUnretire}>
                    <RotateCcw className="size-4" />
                    Unretire
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={onRetire}>
                    <Trash2 className="size-4" />
                    Retire
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * Tag-count icon button that pops a list of every tag on this gear.
 * Opens on hover (desktop) AND on click/tap (mobile) — Radix Popover
 * provides the click path; we layer `onPointerEnter` / `onPointerLeave`
 * timers for the hover behavior. A small close-delay lets the user
 * move into the popover content without the panel snapping shut.
 */
function TagsPopover({ tags }: { tags: GearSummary["tags"] }) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function openNow() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }

  function closeSoon() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 150);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          aria-label={`${tags.length} ${tags.length === 1 ? "tag" : "tags"}`}
          onPointerEnter={openNow}
          onPointerLeave={closeSoon}
        >
          <Tag className="size-4" />
          <span className="text-xs font-medium">{tags.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto max-w-xs p-2"
        onPointerEnter={openNow}
        onPointerLeave={closeSoon}
      >
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t.publicId} variant="outline">
              #{t.name}
            </Badge>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

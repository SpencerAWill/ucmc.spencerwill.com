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

const GEAR_PLACEHOLDER_SRC = "/gear-placeholder.svg";

/**
 * Vertically-oriented card used in grid view. Thumbnail on top with a
 * 1:1 aspect ratio, info stacked beneath. Tags collapse into the same
 * hover/tap popover used by the list card so card height stays
 * uniform across the grid.
 */
export function GearGridCard({
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
        "flex flex-col gap-0 overflow-hidden p-0 transition-shadow",
        selected ? "ring-2 ring-primary" : undefined,
      )}
    >
      <div className="relative">
        <Link
          to="/gear/$publicId"
          params={{ publicId: gear.publicId }}
          className="block aspect-square bg-muted"
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
            className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-md border border-border bg-background/90 shadow-sm transition-opacity hover:bg-background"
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

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        <h3 className="text-sm leading-snug font-medium">
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
                {i > 0 ? <span className="mx-1">·</span> : null}
                {part === gear.code ? (
                  <span className="font-mono">{part}</span>
                ) : (
                  part
                )}
              </span>
            ))}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge variant={CONDITION_VARIANT[gear.condition]}>
              {CONDITION_LABEL[gear.condition]}
            </Badge>
            {isRetired ? <Badge variant="outline">Retired</Badge> : null}
          </div>
          <div className="flex items-center gap-0">
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
      </div>
    </Card>
  );
}

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

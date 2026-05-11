import { Link } from "@tanstack/react-router";
import { Edit, MoreVertical, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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

/**
 * List-card view of a single gear row. Layout:
 *
 *   ┌────┐  Description (primary heading)              [⋮]
 *   │img │  Type · Code
 *   │img │  [Condition] [Retired?]
 *   └────┘  [#tag1] [#tag2] [+N]
 *
 * Uses a CSS grid (not the `Item` primitive) because the grid layout
 * naturally stretches every cell to the row's height — the only
 * reliable way to make the thumbnail fill the card's full vertical
 * space regardless of how tall the content column gets.
 *
 * Acquisition date and cost are intentionally absent here — they live
 * on the detail page so the list stays scannable. On mobile the
 * thumbnail shrinks; the overflow menu collapses edit / retire into a
 * single icon to keep the row tight.
 */
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
  // Description is the primary heading. Falls back to the type's name
  // when no description was entered (rare, but possible for fresh
  // gear). Type + code always sit on the subtitle line.
  const primaryText = gear.description ?? gear.type.name;
  const subtitleParts = [
    gear.description ? gear.type.name : null,
    gear.code,
  ].filter((p): p is string => p !== null);

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-[5rem_1fr_auto] sm:grid-cols-[7rem_1fr_auto]">
        {/* Image cell — grid auto-stretches it to row height, and
         * h-full/w-full + object-cover fill the cell. The Link wrapper
         * makes the thumbnail clickable like the title. */}
        <Link
          to="/gear/$publicId"
          params={{ publicId: gear.publicId }}
          className="block bg-muted"
          aria-label={`Open ${primaryText}`}
        >
          <img
            src={GEAR_PLACEHOLDER_SRC}
            alt=""
            className="h-full w-full object-cover"
          />
        </Link>

        {/* Content cell */}
        <div className="min-w-0 space-y-1 p-3 sm:p-4">
          <h3 className="text-base leading-snug font-medium">
            <Link
              to="/gear/$publicId"
              params={{ publicId: gear.publicId }}
              className="line-clamp-2 underline-offset-4 hover:underline"
            >
              {primaryText}
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
          {gear.tags.length > 0 ? <TagsRow tags={gear.tags} /> : null}
        </div>

        {/* Actions cell — top-aligned so the icon doesn't drift to the
         * vertical centre on tall cards. */}
        {canManage ? (
          <div className="p-2 sm:p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${gear.code ?? primaryText}`}
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
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const TAG_DISPLAY_LIMIT = 3;

function TagsRow({ tags }: { tags: GearSummary["tags"] }) {
  const visible = tags.slice(0, TAG_DISPLAY_LIMIT);
  const overflow = tags.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {visible.map((tag) => (
        <Badge key={tag.publicId} variant="outline" className="max-w-[10rem]">
          <span className="truncate">#{tag.name}</span>
        </Badge>
      ))}
      {overflow > 0 ? (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title={tags
            .slice(TAG_DISPLAY_LIMIT)
            .map((t) => `#${t.name}`)
            .join(", ")}
        >
          +{overflow}
        </Badge>
      ) : null}
    </div>
  );
}

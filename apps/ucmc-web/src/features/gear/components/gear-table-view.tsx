import { Link } from "@tanstack/react-router";
import { Edit, MoreVertical, RotateCcw, Tag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { GearSummary } from "#/features/gear/server/gear-fns";
import { GearTagChip } from "#/features/gear/components/gear-tag-chip";
import {
  CONDITION_LABEL,
  CONDITION_VARIANT,
  availabilityBadge,
  availabilityNote,
  isTerminalStatus,
} from "#/features/gear/lib/labels";

/**
 * Dense tabular view of the gear list. No thumbnails — meant for
 * officers scanning hundreds of items at once.
 *
 * Availability leads the state columns, because the table is where an
 * officer with hundreds of pieces works and the rollup is the question
 * being asked. It used to show `condition` alone, which meant a row on
 * loan, a row missing and a row held all read "Serviceable" — one of
 * the three axes, and not the one anybody came for. Manufacturer is
 * gone to pay for the space: it belongs to the model, is identical
 * down every run of rows for a product, and is one click away.
 */
export function GearTableView({
  rows,
  canManage,
  selectedPublicIds,
  onToggleSelect,
  onToggleAllOnPage,
  allOnPageSelected,
  someOnPageSelected,
  onEdit,
  onRetire,
  onUnretire,
}: {
  rows: GearSummary[];
  canManage: boolean;
  selectedPublicIds: Set<string>;
  onToggleSelect: (publicId: string) => void;
  onToggleAllOnPage: () => void;
  allOnPageSelected: boolean;
  someOnPageSelected: boolean;
  onEdit: (gear: GearSummary) => void;
  onRetire: (gear: GearSummary) => void;
  onUnretire: (gear: GearSummary) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {canManage ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    allOnPageSelected
                      ? true
                      : someOnPageSelected
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={onToggleAllOnPage}
                  aria-label="Select all on this page"
                />
              </TableHead>
            ) : null}
            <TableHead className="w-22">Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden sm:table-cell">Availability</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">Condition</TableHead>
            <TableHead className="w-12 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((g) => {
            const isInactive = isTerminalStatus(g.status);
            const badge = availabilityBadge(g);
            const note = availabilityNote(g);
            return (
              <TableRow
                key={g.publicId}
                data-state={
                  selectedPublicIds.has(g.publicId) ? "selected" : undefined
                }
              >
                {canManage ? (
                  <TableCell className="w-10">
                    <Checkbox
                      checked={selectedPublicIds.has(g.publicId)}
                      onCheckedChange={() => onToggleSelect(g.publicId)}
                      aria-label={`Select ${g.code ?? g.description}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="font-mono text-xs">
                  {g.code ? (
                    <Link
                      to="/gear/$publicId"
                      params={{ publicId: g.publicId }}
                      className="underline-offset-4 hover:underline"
                    >
                      {g.code}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-0">
                  <Link
                    to="/gear/$publicId"
                    params={{ publicId: g.publicId }}
                    className="block truncate underline-offset-4 hover:underline"
                  >
                    {g.description}
                  </Link>
                  {/* Below sm the state columns are gone, so the row's
                   * answer to "can I take this out" folds in here. It
                   * leads, ahead of type and condition. */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:hidden">
                    <span className="font-medium text-foreground">
                      {badge.label}
                    </span>
                    {note ? <span>· {note}</span> : null}
                    <span>· {g.type.name}</span>
                    <span>· {CONDITION_LABEL[g.condition]}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {note ? (
                      <span className="text-muted-foreground">{note}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {g.type.name}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge
                    variant={CONDITION_VARIANT[g.condition]}
                    className="text-xs"
                  >
                    {CONDITION_LABEL[g.condition]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-0">
                    {g.tags.length > 0 ? <TagsPopover tags={g.tags} /> : null}
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${g.code ?? g.description}`}
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onEdit(g)}>
                            <Edit className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          {isInactive ? (
                            <DropdownMenuItem onSelect={() => onUnretire(g)}>
                              <RotateCcw className="size-4" />
                              Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => onRetire(g)}>
                              <Trash2 className="size-4" />
                              Retire
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
            <GearTagChip key={t.publicId} name={t.name} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

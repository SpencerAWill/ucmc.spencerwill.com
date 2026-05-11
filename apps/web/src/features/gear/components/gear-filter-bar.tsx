/**
 * Gear list filter + sort controls. Layout mirrors the members page:
 *
 *   Row 1: [ 🔍 Search ............................. ] [list/grid toggle]
 *   Row 2: [ ⚙ Filters (N) ▾ ]  [ Sort: ... ▾ ]
 *
 * Filters live in a Popover keyed by a single button so the bar
 * collapses to two narrow controls on mobile. The active-filter count
 * surfaces on the button so officers can see at a glance whether the
 * list is restricted without opening the popover.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Filter,
  LayoutGrid,
  List,
  Rows3,
  Search,
} from "lucide-react";

import { Button } from "#/components/ui/button";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import {
  gearTagsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearLifecycle,
} from "#/features/gear/server/gear-fns";

const LIFECYCLE_VALUES = ["active", "retired"] as const;
const LIFECYCLE_LABEL: Record<GearLifecycle, string> = {
  active: "Active",
  retired: "Retired",
};
const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

export type GearSortMode = "code" | "created_at" | "updated_at";

const SORT_OPTIONS: { value: GearSortMode; label: string }[] = [
  { value: "code", label: "Code" },
  { value: "created_at", label: "Newest" },
  { value: "updated_at", label: "Updated" },
];

export type GearView = "list" | "grid" | "table";

export interface GearFilterState {
  typePublicId: string | null;
  tagPublicIds: string[];
  lifecycle: GearLifecycle;
  condition: GearCondition | null;
  q: string;
  sort: GearSortMode;
  view: GearView;
}

export function GearFilterBar({
  state,
  onChange,
}: {
  state: GearFilterState;
  onChange: (next: GearFilterState) => void;
}) {
  const { data: types } = useQuery(gearTypesQueryOptions());
  const { data: tags } = useQuery(gearTagsQueryOptions());

  // Active-filter count counts every dimension that's away from its
  // default: non-empty search, non-default lifecycle (retired counts),
  // any type / condition / tags. Sort and view are display preferences
  // and don't count toward "filters applied".
  const activeFilterCount =
    (state.typePublicId !== null ? 1 : 0) +
    (state.tagPublicIds.length > 0 ? 1 : 0) +
    (state.lifecycle !== "active" ? 1 : 0) +
    (state.condition !== null ? 1 : 0);

  const clearFilters = () =>
    onChange({
      ...state,
      typePublicId: null,
      tagPublicIds: [],
      lifecycle: "active",
      condition: null,
    });

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: search + view toggle */}
      <div className="flex items-center gap-3">
        {/* Search is wired through the server already but the relevance
         * tuning isn't there yet — disabled with a placeholder until
         * the LIKE/FTS strategy lands. */}
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search coming soon…" className="pl-9" disabled />
        </div>
        {/* Three-way view toggle: list (thumbnail + info card per row),
         * grid (square-thumbnail tiles, multi-column), table (dense
         * tabular rows, no thumbnail). Officers with hundreds of items
         * usually want table mode. */}
        <div className="flex h-9 rounded-md border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={state.view === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-full w-9 rounded-none rounded-l-md"
                onClick={() => onChange({ ...state, view: "list" })}
              >
                <List className="size-4" />
                <span className="sr-only">List view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>List view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={state.view === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-full w-9 rounded-none"
                onClick={() => onChange({ ...state, view: "grid" })}
              >
                <LayoutGrid className="size-4" />
                <span className="sr-only">Grid view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Grid view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={state.view === "table" ? "secondary" : "ghost"}
                size="icon"
                className="h-full w-9 rounded-none rounded-r-md"
                onClick={() => onChange({ ...state, view: "table" })}
              >
                <Rows3 className="size-4" />
                <span className="sr-only">Table view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Table view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2: filters popover + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9">
              <Filter className="mr-2 size-4" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(20rem,calc(100vw-2rem))] space-y-4"
            align="start"
          >
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Type
              </Label>
              <Select
                value={state.typePublicId ?? "__all__"}
                onValueChange={(v) =>
                  onChange({
                    ...state,
                    typePublicId: v === "__all__" ? null : v,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {(types ?? []).map((t) => (
                    <SelectItem key={t.publicId} value={t.publicId}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Lifecycle
              </Label>
              {/* Single-value pick → RadioGroup, not Checkbox. The
               * filter is either "active" or "retired"; both isn't a
               * valid state in this UI (the underlying server param
               * is a single enum). */}
              <RadioGroup
                value={state.lifecycle}
                onValueChange={(v) =>
                  onChange({
                    ...state,
                    lifecycle: v as (typeof LIFECYCLE_VALUES)[number],
                  })
                }
                className="flex flex-col gap-1.5 text-sm"
              >
                {LIFECYCLE_VALUES.map((v) => (
                  <label key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`lifecycle-${v}`} />
                    {LIFECYCLE_LABEL[v]}
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Condition
              </Label>
              <Select
                value={state.condition ?? "__any__"}
                onValueChange={(v) =>
                  onChange({
                    ...state,
                    condition: v === "__any__" ? null : (v as GearCondition),
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Any condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any condition</SelectItem>
                  {GEAR_CONDITION_VALUES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Tags
              </Label>
              <GearTagMultiselect
                allTags={tags ?? []}
                selectedPublicIds={state.tagPublicIds}
                onChange={(ids) => onChange({ ...state, tagPublicIds: ids })}
                canCreate={false}
              />
            </div>

            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>

        {/* Sort sits to the far right — secondary control next to the
         * primary "Filters" affordance. Icon-led label keeps it short
         * on mobile (just "Code" / "Newest" / "Updated"). */}
        <Select
          value={state.sort}
          onValueChange={(v) => onChange({ ...state, sort: v as GearSortMode })}
        >
          <SelectTrigger className="ml-auto h-9 w-auto gap-1.5">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

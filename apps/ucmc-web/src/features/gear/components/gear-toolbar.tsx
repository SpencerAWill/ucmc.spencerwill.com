/**
 * Gear's `<DataToolbar />`: the shared control, filled with gear's
 * filter fields, sort keys and view modes.
 *
 * Everything about the *shape* of the bar — order, seams, the mobile
 * drawer, the chip row — lives in `#/components/data-toolbar`. What's
 * here is only the dataset-specific material, which is the split that
 * lets `/members` look identical without sharing a line of gear code.
 */
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, List, Rows3 } from "lucide-react";

import { DataToolbar } from "#/components/data-toolbar";
import type {
  DataToolbarFilterChip,
  DataToolbarSortOption,
  DataToolbarViewOption,
  SortDirection,
} from "#/components/data-toolbar";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  gearTagsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearStatus,
} from "#/features/gear/server/gear-fns";
import { CONDITION_LABEL, STATUS_LABEL } from "#/features/gear/lib/labels";

const STATUS_VALUES = ["active", "retired"] as const;

export type GearItemSortKey = "code" | "created_at" | "updated_at";

export const GEAR_SORT_OPTIONS: DataToolbarSortOption<GearItemSortKey>[] = [
  { value: "code", label: "Code", ascLabel: "A → Z", descLabel: "Z → A" },
  {
    value: "created_at",
    label: "Date added",
    defaultDirection: "desc",
    ascLabel: "Oldest first",
    descLabel: "Newest first",
  },
  {
    value: "updated_at",
    label: "Last updated",
    defaultDirection: "desc",
    ascLabel: "Least recent",
    descLabel: "Most recent",
  },
];

export type GearView = "list" | "grid" | "table";

/** List (thumbnail + info card per row), grid (square tiles), table
 *  (dense rows, no thumbnail). Officers with hundreds of pieces live in
 *  table mode. */
export const GEAR_VIEW_OPTIONS: DataToolbarViewOption<GearView>[] = [
  { value: "list", label: "List", icon: List },
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "table", label: "Table", icon: Rows3 },
];

export interface GearToolbarState {
  typePublicId: string | null;
  tagPublicIds: string[];
  status: GearStatus;
  condition: GearCondition | null;
  q: string;
  sort: GearItemSortKey;
  dir: SortDirection;
  view: GearView;
}

export function GearToolbar({
  state,
  onChange,
  bulkActions,
}: {
  state: GearToolbarState;
  onChange: (next: Partial<GearToolbarState>) => void;
  bulkActions?: {
    selectedCount: number;
    items: React.ReactNode;
    onClearSelection: () => void;
    disabled: boolean;
  };
}) {
  const { data: types } = useQuery(gearTypesQueryOptions());
  const { data: tags } = useQuery(gearTagsQueryOptions());

  // Search, sort and view are excluded: search has its own box and its
  // own clear button, and the other two are display preferences, not
  // restrictions on what's in the list.
  const chips: DataToolbarFilterChip[] = [
    ...(state.typePublicId !== null
      ? [
          {
            key: `type:${state.typePublicId}`,
            label:
              types?.find((t) => t.publicId === state.typePublicId)?.name ??
              "Type",
            onRemove: () => onChange({ typePublicId: null }),
          },
        ]
      : []),
    ...(state.status !== "active"
      ? [
          {
            key: `status:${state.status}`,
            label: STATUS_LABEL[state.status],
            onRemove: () => onChange({ status: "active" }),
          },
        ]
      : []),
    ...(state.condition !== null
      ? [
          {
            key: `condition:${state.condition}`,
            label: CONDITION_LABEL[state.condition],
            onRemove: () => onChange({ condition: null }),
          },
        ]
      : []),
    ...state.tagPublicIds.map((id) => ({
      key: `tag:${id}`,
      label: tags?.find((t) => t.publicId === id)?.name ?? "Tag",
      onRemove: () =>
        onChange({
          tagPublicIds: state.tagPublicIds.filter((t) => t !== id),
        }),
    })),
  ];

  const clearFilters = () =>
    onChange({
      typePublicId: null,
      tagPublicIds: [],
      status: "active",
      condition: null,
    });

  return (
    <DataToolbar
      label="Gear list controls"
      search={{
        value: state.q,
        onChange: (q) => onChange({ q }),
        placeholder: "Search code, description, manufacturer…",
      }}
      filters={{
        // Every dimension away from its default counts, including
        // `retired` — the count is "how restricted is this list", and
        // the chips below spell out by what.
        activeCount: chips.length,
        chips,
        onClear: clearFilters,
        title: "Filter gear",
        children: (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Type
              </Label>
              <Select
                value={state.typePublicId ?? "__all__"}
                onValueChange={(v) =>
                  onChange({ typePublicId: v === "__all__" ? null : v })
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
               * underlying server param is a single enum; "both" isn't
               * a state this filter can express. */}
              <RadioGroup
                value={state.status}
                onValueChange={(v) =>
                  onChange({
                    status: v as (typeof STATUS_VALUES)[number],
                  })
                }
                className="flex flex-col gap-1.5 text-sm"
              >
                {STATUS_VALUES.map((v) => (
                  <label key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`lifecycle-${v}`} />
                    {STATUS_LABEL[v]}
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
                onChange={(ids) => onChange({ tagPublicIds: ids })}
                canCreate={false}
              />
            </div>
          </>
        ),
      }}
      bulkActions={
        bulkActions
          ? {
              selectedCount: bulkActions.selectedCount,
              children: bulkActions.items,
              onClearSelection: bulkActions.onClearSelection,
              disabled: bulkActions.disabled,
            }
          : undefined
      }
      sort={{
        value: state.sort,
        direction: state.dir,
        options: GEAR_SORT_OPTIONS,
        onChange: ({ sort, direction }) => onChange({ sort, dir: direction }),
      }}
      view={{
        value: state.view,
        options: GEAR_VIEW_OPTIONS,
        onChange: (view) => onChange({ view }),
      }}
    />
  );
}

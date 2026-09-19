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
import { LayoutGrid, List, Package, Rows3 } from "lucide-react";

import { DataToolbar } from "#/components/data-toolbar";
import type {
  DataToolbarFilterChip,
  DataToolbarSortOption,
  DataToolbarViewOption,
  SortDirection,
} from "#/components/data-toolbar";
import { Checkbox } from "#/components/ui/checkbox";
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
  gearAttributeDefsQueryOptions,
  gearModelBrowseQueryOptions,
  gearTagsQueryOptions,
  gearTypesQueryOptions,
} from "#/features/gear/api/queries";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import {
  AVAILABILITY_LABEL,
  GEAR_AVAILABILITY,
} from "#/features/gear/lib/availability";
import type { GearAvailability } from "#/features/gear/lib/availability";
import type {
  GearCondition,
  GearStatus,
} from "#/features/gear/server/gear-fns";
import { CONDITION_LABEL, STATUS_LABEL } from "#/features/gear/lib/labels";

const STATUS_VALUES = ["active", "retired"] as const;

export const INSPECTION_FILTER_VALUES = [
  "overdue",
  "due_soon",
  "never",
] as const;

/** Phrased as the backlog an officer is working, not as the state of
 *  the row — "Overdue" alone in a filter list reads as overdue *what*. */
const INSPECTION_FILTER_LABEL: Record<
  (typeof INSPECTION_FILTER_VALUES)[number],
  string
> = {
  overdue: "Inspection overdue",
  due_soon: "Due within two weeks",
  never: "Never inspected",
};

export const SERVICE_LIFE_FILTER_VALUES = [
  "expired",
  "expiring",
  "unknown",
] as const;

const SERVICE_LIFE_FILTER_LABEL: Record<
  (typeof SERVICE_LIFE_FILTER_VALUES)[number],
  string
> = {
  expired: "Past service life",
  expiring: "Ages out within a year",
  unknown: "Age unknown",
};

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

export type GearView = "list" | "grid" | "table" | "models";

/** List (thumbnail + info card per row), grid (square tiles), table
 *  (dense rows, no thumbnail). Officers with hundreds of pieces live in
 *  table mode. */
export const GEAR_VIEW_OPTIONS: DataToolbarViewOption<GearView>[] = [
  { value: "list", label: "List", icon: List },
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "table", label: "Table", icon: Rows3 },
  // Browse-by-model: the member's view of the same data, where the
  // unit of interest is the product rather than the piece.
  { value: "models", label: "Models", icon: Package },
];

export interface GearToolbarState {
  typePublicId: string | null;
  /** Set by picking a model in the browse view. Its own filter rather
   *  than a type filter, because "this exact product" is what the
   *  member just asked for. */
  modelPublicId: string | null;
  /** The two safety backlogs. Separate filters rather than one
   *  "needs attention" because they are different jobs: one is booking
   *  an inspection, the other is spending money. */
  inspection: "overdue" | "due_soon" | "never" | null;
  serviceLife: "expired" | "expiring" | "unknown" | null;
  /** Facet selections, `defPublicId → chosen values`. Scoped to the
   *  selected type, because a facet without one would have to merge
   *  every definition in the club into a single unreadable list. */
  attributes: Record<string, string[]>;
  tagPublicIds: string[];
  status: GearStatus;
  availability: GearAvailability | null;
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
  // Only the enumerable kinds make facets: free text would list four
  // hundred distinct answers, and a number wants a range, which the
  // browse-by-model redesign is the right place for.
  const { data: attributeDefs } = useQuery({
    ...gearAttributeDefsQueryOptions({ typePublicId: state.typePublicId }),
    enabled: state.typePublicId !== null,
  });
  // Resolves the model chip's label. Uses the browse read rather than
  // the officer model list: the chip has to render for members too,
  // and that list gates on gear:manage.
  const { data: browseModels } = useQuery({
    ...gearModelBrowseQueryOptions(),
    enabled: state.modelPublicId !== null,
  });
  const facetDefs = (attributeDefs ?? []).filter(
    (def) => def.kind === "select" || def.kind === "boolean",
  );

  const setFacet = (defPublicId: string, values: string[]) => {
    const next = { ...state.attributes };
    if (values.length === 0) {
      delete next[defPublicId];
    } else {
      next[defPublicId] = values;
    }
    onChange({ attributes: next });
  };

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
    ...(state.availability !== null
      ? [
          {
            key: `availability:${state.availability}`,
            label: AVAILABILITY_LABEL[state.availability],
            onRemove: () => onChange({ availability: null }),
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
    ...(state.modelPublicId !== null
      ? [
          {
            key: `model:${state.modelPublicId}`,
            label:
              browseModels?.find((m) => m.publicId === state.modelPublicId)
                ?.name ?? "Model",
            onRemove: () => onChange({ modelPublicId: null }),
          },
        ]
      : []),
    ...(state.inspection !== null
      ? [
          {
            key: `inspection:${state.inspection}`,
            label: INSPECTION_FILTER_LABEL[state.inspection],
            onRemove: () => onChange({ inspection: null }),
          },
        ]
      : []),
    ...(state.serviceLife !== null
      ? [
          {
            key: `serviceLife:${state.serviceLife}`,
            label: SERVICE_LIFE_FILTER_LABEL[state.serviceLife],
            onRemove: () => onChange({ serviceLife: null }),
          },
        ]
      : []),
    ...facetDefs.flatMap((def) =>
      (state.attributes[def.publicId] ?? []).map((value) => ({
        key: `attr:${def.publicId}:${value}`,
        // The label names the question as well as the answer: "M"
        // alone on a chip row beside "#outdoor" says nothing.
        label: `${def.label}: ${
          def.kind === "boolean" ? (value === "true" ? "Yes" : "No") : value
        }`,
        onRemove: () =>
          setFacet(
            def.publicId,
            (state.attributes[def.publicId] ?? []).filter((v) => v !== value),
          ),
      })),
    ),
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
      modelPublicId: null,
      tagPublicIds: [],
      status: "active",
      condition: null,
      attributes: {},
      inspection: null,
      serviceLife: null,
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
                Availability
              </Label>
              <Select
                value={state.availability ?? "__any__"}
                onValueChange={(v) =>
                  onChange({
                    availability:
                      v === "__any__" ? null : (v as GearAvailability),
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Any availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any availability</SelectItem>
                  {GEAR_AVAILABILITY.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AVAILABILITY_LABEL[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Rolls up status, condition, whereabouts and loans into the one
                question: can I take this out?
              </p>
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
                Inspection
              </Label>
              <Select
                value={state.inspection ?? "__any__"}
                onValueChange={(v) =>
                  onChange({
                    inspection:
                      v === "__any__"
                        ? null
                        : (v as NonNullable<GearToolbarState["inspection"]>),
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {INSPECTION_FILTER_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {INSPECTION_FILTER_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Cadence only. An overdue inspection means nobody has looked yet
                — it doesn't block checkout, an <em>unsafe</em> flag does.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Service life
              </Label>
              <Select
                value={state.serviceLife ?? "__any__"}
                onValueChange={(v) =>
                  onChange({
                    serviceLife:
                      v === "__any__"
                        ? null
                        : (v as NonNullable<GearToolbarState["serviceLife"]>),
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {SERVICE_LIFE_FILTER_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {SERVICE_LIFE_FILTER_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Facets appear only once a type is chosen. Attributes
             * are scoped to types by design, so an unscoped list would
             * be every question the club has ever asked, most of them
             * meaningless for most rows. */}
            {facetDefs.map((def) => {
              const selected = state.attributes[def.publicId] ?? [];
              return (
                <div key={def.publicId} className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    {def.label}
                  </Label>
                  {def.kind === "boolean" ? (
                    <RadioGroup
                      value={selected[0] ?? "__any__"}
                      onValueChange={(v) =>
                        setFacet(def.publicId, v === "__any__" ? [] : [v])
                      }
                      className="flex flex-col gap-1.5 text-sm"
                    >
                      {(
                        [
                          ["__any__", "Any"],
                          ["true", "Yes"],
                          ["false", "No"],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2">
                          <RadioGroupItem
                            value={value}
                            id={`facet-${def.publicId}-${value}`}
                          />
                          {label}
                        </label>
                      ))}
                    </RadioGroup>
                  ) : (
                    /* Checkboxes, not a select: values within one
                     * attribute are alternatives, so "M or L" has to be
                     * expressible. The tag filter is AND-only for the
                     * opposite reason. */
                    <div className="flex flex-col gap-1.5 text-sm">
                      {(def.options ?? []).map((option) => (
                        <label
                          key={option}
                          className="flex items-center gap-2"
                          htmlFor={`facet-${def.publicId}-${option}`}
                        >
                          <Checkbox
                            id={`facet-${def.publicId}-${option}`}
                            checked={selected.includes(option)}
                            onCheckedChange={(checked) =>
                              setFacet(
                                def.publicId,
                                checked === true
                                  ? [...selected, option]
                                  : selected.filter((v) => v !== option),
                              )
                            }
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

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

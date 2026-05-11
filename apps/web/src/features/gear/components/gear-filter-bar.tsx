import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
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

export interface GearFilterState {
  typePublicId: string | null;
  tagPublicIds: string[];
  lifecycle: GearLifecycle;
  condition: GearCondition | null;
  q: string;
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

  const reset = () =>
    onChange({
      typePublicId: null,
      tagPublicIds: [],
      lifecycle: "active",
      condition: null,
      q: "",
    });

  const hasFilters =
    state.typePublicId !== null ||
    state.tagPublicIds.length > 0 ||
    state.lifecycle !== "active" ||
    state.condition !== null ||
    state.q.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.q}
            onChange={(e) => onChange({ ...state, q: e.target.value })}
            placeholder="Search code, description, notes…"
            className="pl-8"
          />
        </div>
        <Select
          value={state.typePublicId ?? "__all__"}
          onValueChange={(v) =>
            onChange({ ...state, typePublicId: v === "__all__" ? null : v })
          }
        >
          <SelectTrigger className="w-[180px]">
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
        <Select
          value={state.lifecycle}
          onValueChange={(v) =>
            onChange({ ...state, lifecycle: v as GearLifecycle })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_VALUES.map((v) => (
              <SelectItem key={v} value={v}>
                {LIFECYCLE_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.condition ?? "__any__"}
          onValueChange={(v) =>
            onChange({
              ...state,
              condition: v === "__any__" ? null : (v as GearCondition),
            })
          }
        >
          <SelectTrigger className="w-[160px]">
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
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="size-4" />
            Reset
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Tags:</span>
        <div className="flex-1">
          <GearTagMultiselect
            allTags={tags ?? []}
            selectedPublicIds={state.tagPublicIds}
            onChange={(ids) => onChange({ ...state, tagPublicIds: ids })}
            canCreate={false}
          />
        </div>
        {state.tagPublicIds.length > 0 ? (
          <Badge variant="outline">
            {state.tagPublicIds.length} tag
            {state.tagPublicIds.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The members directory's `<DataToolbar />` — the same control the gear
 * list uses, filled with this dataset's filter fields, sort keys and
 * view modes. Shape lives in `#/components/data-toolbar`; only the
 * material is here.
 *
 * No bulk slot: the approved directory has no multi-select. The slot
 * simply isn't passed, and the seam closes around it.
 */
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, List } from "lucide-react";

import { DataToolbar } from "#/components/data-toolbar";
import type {
  DataToolbarFilterChip,
  DataToolbarSortOption,
  DataToolbarViewOption,
  SortDirection,
} from "#/components/data-toolbar";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { rolesQueryOptions } from "#/features/members/api/queries";
import type { RoleOption } from "#/features/members/server/member-fns";

export const AFFILIATION_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "faculty", label: "Faculty" },
  { value: "staff", label: "Staff" },
  { value: "alum", label: "Alum" },
  { value: "community", label: "Community" },
] as const;

export type MemberSortKey = "name" | "created";

export const MEMBER_SORT_OPTIONS: DataToolbarSortOption<MemberSortKey>[] = [
  { value: "name", label: "Name", ascLabel: "A → Z", descLabel: "Z → A" },
  {
    value: "created",
    label: "Date joined",
    defaultDirection: "desc",
    ascLabel: "Oldest first",
    descLabel: "Newest first",
  },
];

export type MembersView = "list" | "grid";

export const MEMBER_VIEW_OPTIONS: DataToolbarViewOption<MembersView>[] = [
  { value: "list", label: "List", icon: List },
  { value: "grid", label: "Grid", icon: LayoutGrid },
];

export interface MembersToolbarState {
  q: string;
  affiliations: string[];
  roles: string[];
  sort: MemberSortKey;
  dir: SortDirection;
  view: MembersView;
}

export function MembersToolbar({
  state,
  onChange,
}: {
  state: MembersToolbarState;
  onChange: (next: Partial<MembersToolbarState>) => void;
}) {
  const { data: roleOptions = [] } = useQuery({
    ...rolesQueryOptions(),
    staleTime: 5 * 60 * 1000, // roles rarely change
  });

  const toggle = (key: "affiliations" | "roles", value: string) => {
    const current = state[key];
    onChange({
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  };

  const remove = (key: "affiliations" | "roles", value: string) =>
    onChange({ [key]: state[key].filter((v) => v !== value) });

  const chips: DataToolbarFilterChip[] = [
    ...state.affiliations.map((value) => ({
      key: `affiliation:${value}`,
      label: AFFILIATION_OPTIONS.find((o) => o.value === value)?.label ?? value,
      onRemove: () => remove("affiliations", value),
    })),
    // Chips show `displayName` — the label an operator typed at
    // /access — while the filter itself travels as the `name` slug.
    ...state.roles.map((value) => ({
      key: `role:${value}`,
      label:
        roleOptions.find((r: RoleOption) => r.name === value)?.displayName ??
        value,
      onRemove: () => remove("roles", value),
    })),
  ];

  return (
    <DataToolbar
      label="Member directory controls"
      search={{
        value: state.q,
        onChange: (q) => onChange({ q }),
        placeholder: "Search name or email…",
      }}
      filters={{
        activeCount: chips.length,
        chips,
        onClear: () => onChange({ affiliations: [], roles: [] }),
        title: "Filter members",
        children: (
          <>
            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Affiliation
              </Label>
              {AFFILIATION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={state.affiliations.includes(opt.value)}
                    onCheckedChange={() => toggle("affiliations", opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Role
              </Label>
              {roleOptions.map((role: RoleOption) => (
                <label
                  key={role.name}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={state.roles.includes(role.name)}
                    onCheckedChange={() => toggle("roles", role.name)}
                  />
                  <span>{role.displayName}</span>
                </label>
              ))}
            </div>
          </>
        ),
      }}
      sort={{
        value: state.sort,
        direction: state.dir,
        options: MEMBER_SORT_OPTIONS,
        onChange: ({ sort, direction }) => onChange({ sort, dir: direction }),
      }}
      view={{
        value: state.view,
        options: MEMBER_VIEW_OPTIONS,
        onChange: (view) => onChange({ view }),
      }}
    />
  );
}

/**
 * The loans list's `<DataToolbar />` — the same control `/gear` and
 * `/members` use, filled with this dataset's filter fields and sort
 * keys. Shape lives in `#/components/data-toolbar`; only the material
 * is here.
 *
 * Replaces the bespoke two-row `LoanFilterBar`, whose own comment had
 * been admitting it was the last list page not yet converted.
 *
 * Three things are specific to loans and worth stating:
 *
 *  - **The Active/History tabs sit above the toolbar, not inside it.**
 *    They choose *which dataset* is on screen; every toolbar slot
 *    narrows or re-presents the one already chosen. Folding them into
 *    the connected group would put a different kind of control in the
 *    row whose whole value is that its controls are the same
 *    everywhere.
 *  - **`q` moved out of the filter popover into the real search slot**,
 *    which buys the debounce and the "/" shortcut it never had.
 *  - **No bulk and no view slot.** The list has no multi-select and one
 *    presentation; the slots simply aren't passed and the seam closes
 *    around them.
 */
import { X } from "lucide-react";

import { DataToolbar } from "#/components/data-toolbar";
import type {
  DataToolbarFilterChip,
  DataToolbarSortOption,
  SortDirection,
} from "#/components/data-toolbar";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { MemberSearchCombobox } from "#/features/gear/components/member-search-combobox";
import type { LoanSortKey } from "#/features/gear/lib/loan-sort";
import type { MemberSearchResult } from "#/features/gear/server/gear-fns";

/**
 * Direction labels are spelled out per key because "Ascending" on a due
 * date tells an officer nothing — "Most overdue first" is the question
 * they actually came to the page with.
 */
export const LOAN_SORT_OPTIONS: DataToolbarSortOption<LoanSortKey>[] = [
  {
    value: "due_at",
    label: "Due date",
    ascLabel: "Most overdue first",
    descLabel: "Due last",
  },
  {
    value: "checked_out_at",
    label: "Checked out",
    defaultDirection: "desc",
    ascLabel: "Longest held",
    descLabel: "Newest first",
  },
];

export interface LoansToolbarState {
  tab: "active" | "history";
  /** Free text against gear code, model, manufacturer, member name or
   *  member email. Member filtering has its own picker (see
   *  `selectedMember`) rather than being folded in here — a combobox is
   *  more discoverable than typing a partial name and hoping. */
  q: string;
  overdueOnly: boolean;
  sort: LoanSortKey;
  dir: SortDirection;
  selectedMember: MemberSearchResult | null;
}

export function LoansToolbar({
  state,
  onChange,
}: {
  state: LoansToolbarState;
  onChange: (next: Partial<LoansToolbarState>) => void;
}) {
  // Chips spell out what the popover narrowed by. The count badge says
  // *that* the list is restricted; only the chips answer "by what",
  // which is the question someone opening a shared overdue-list URL
  // actually has. `q` isn't a chip — it's visible in the search box.
  const chips: DataToolbarFilterChip[] = [
    ...(state.selectedMember
      ? [
          {
            key: `member:${state.selectedMember.publicId}`,
            label: state.selectedMember.fullName,
            onRemove: () => onChange({ selectedMember: null }),
          },
        ]
      : []),
    // Only meaningful on the active tab, and the field that sets it is
    // hidden on history — so the chip has to disappear with it, or a
    // tab switch would strand a chip with no control behind it.
    ...(state.overdueOnly && state.tab === "active"
      ? [
          {
            key: "overdue",
            label: "Overdue only",
            onRemove: () => onChange({ overdueOnly: false }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      <Tabs
        value={state.tab}
        onValueChange={(v) => onChange({ tab: v as LoansToolbarState["tab"] })}
      >
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataToolbar
        label="Loan list controls"
        search={{
          value: state.q,
          onChange: (q) => onChange({ q }),
          placeholder: "Search code, gear or member…",
        }}
        filters={{
          activeCount: chips.length,
          chips,
          onClear: () => onChange({ selectedMember: null, overdueOnly: false }),
          title: "Filter loans",
          children: (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Member
                </Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <MemberSearchCombobox
                      selected={state.selectedMember}
                      onSelect={(m) => onChange({ selectedMember: m })}
                    />
                  </div>
                  {state.selectedMember ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onChange({ selectedMember: null })}
                      aria-label="Clear member filter"
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              {state.tab === "active" ? (
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="loan-overdue-only"
                    checked={state.overdueOnly}
                    onCheckedChange={(v) =>
                      onChange({ overdueOnly: v === true })
                    }
                  />
                  <Label htmlFor="loan-overdue-only" className="font-normal">
                    Overdue only
                  </Label>
                </div>
              ) : null}
            </>
          ),
        }}
        sort={{
          value: state.sort,
          direction: state.dir,
          options: LOAN_SORT_OPTIONS,
          onChange: ({ sort, direction }) => onChange({ sort, dir: direction }),
        }}
      />
    </div>
  );
}

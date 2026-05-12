import { Filter } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";

export interface LoanFilterState {
  tab: "active" | "history";
  q: string;
  overdueOnly: boolean;
  sort: "due_at" | "checked_out_at";
}

const SORT_LABEL: Record<LoanFilterState["sort"], string> = {
  due_at: "Due date",
  checked_out_at: "Checked out",
};

/** Active count for the popover badge — excludes the always-displayed
 *  tab+sort pair so it surfaces only meaningful narrowing. */
function countActiveFilters(state: LoanFilterState): number {
  return (state.q.trim().length > 0 ? 1 : 0) + (state.overdueOnly ? 1 : 0);
}

export function LoanFilterBar({
  state,
  onChange,
}: {
  state: LoanFilterState;
  onChange: (next: LoanFilterState) => void;
}) {
  const activeFilterCount = countActiveFilters(state);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs
        value={state.tab}
        onValueChange={(v) =>
          onChange({ ...state, tab: v as LoanFilterState["tab"] })
        }
      >
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>
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
        <PopoverContent className="w-80 space-y-4" align="start">
          <div className="space-y-1.5">
            <Label
              htmlFor="loan-q"
              className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
            >
              Search
            </Label>
            <Input
              id="loan-q"
              value={state.q}
              onChange={(e) => onChange({ ...state, q: e.target.value })}
              placeholder="Member name or gear code"
            />
          </div>
          {state.tab === "active" ? (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="loan-overdue-only"
                checked={state.overdueOnly}
                onCheckedChange={(v) =>
                  onChange({ ...state, overdueOnly: v === true })
                }
              />
              <Label htmlFor="loan-overdue-only" className="font-normal">
                Overdue only
              </Label>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <Select
        value={state.sort}
        onValueChange={(v) =>
          onChange({ ...state, sort: v as LoanFilterState["sort"] })
        }
      >
        <SelectTrigger className="ml-auto h-9 w-auto gap-1.5 px-3">
          <span className="text-xs text-muted-foreground">Sort by</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABEL) as LoanFilterState["sort"][]).map((s) => (
            <SelectItem key={s} value={s}>
              {SORT_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

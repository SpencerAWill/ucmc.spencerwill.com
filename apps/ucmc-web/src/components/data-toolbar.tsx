/**
 * The unified list toolbar. One connected control carrying every way a
 * user narrows or re-presents a list, in a fixed left-to-right order:
 *
 *   [ ⛛ ] [ 🔍 Search …………………… ] [ ☑ 3 ] [ ⇅ ] [ ▦ ]
 *   filters   search               bulk    sort  view
 *
 * Every slot is optional — a page that has no bulk actions simply
 * doesn't pass `bulkActions` and the segment isn't in the DOM. **The
 * order is not configurable on purpose**: the point of the component is
 * that the filter button is in the same place on `/gear` as it is on
 * `/members`, so muscle memory carries between pages. A page whose
 * controls want a different order wants a different component.
 *
 * Because the slots are conditional, the connected-group rounding can't
 * come from the static `:first-child` / `:last-child` rules `ButtonGroup`
 * uses — "first" depends on which slots this caller enabled. `seamClass`
 * computes it from the rendered slot list instead, and applies it only
 * at `md:` and up, since the mobile layout is deliberately *not*
 * connected: the search box takes its own full-width row and the icon
 * buttons sit beneath it, spaced.
 *
 * Icon-only controls each carry a Tooltip **and** an `sr-only` label —
 * the tooltip is a pointer affordance and never the accessible name.
 */
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/** Typing shouldn't put a history entry (or a server round trip) on
 *  every keystroke, so the search box holds a local draft and commits
 *  on this delay. Enter and the clear button flush immediately. */
const SEARCH_DEBOUNCE_MS = 300;

export type SortDirection = "asc" | "desc";

export interface DataToolbarSortOption<TSort extends string> {
  value: TSort;
  label: string;
  /** Direction applied when the user switches *to* this property, so
   *  "Date added" lands on newest-first while "Name" lands on A–Z.
   *  Defaults to `asc`. */
  defaultDirection?: SortDirection;
  /** Direction labels worth spelling out per property — "A → Z" reads
   *  better than "Ascending" on a name, "Newest first" better than
   *  "Descending" on a date. Default to Ascending / Descending. */
  ascLabel?: string;
  descLabel?: string;
}

export interface DataToolbarViewOption<TView extends string> {
  value: TView;
  label: string;
  icon: LucideIcon;
}

export interface DataToolbarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface DataToolbarFiltersProps {
  /** How many filter dimensions are away from their default. Surfaces
   *  as a badge so a restricted list is visible without opening the
   *  popover. */
  activeCount: number;
  onClear?: () => void;
  /** The filter fields themselves — different per dataset. */
  children: React.ReactNode;
}

export interface DataToolbarBulkActionsProps {
  selectedCount: number;
  /** `DropdownMenu*` items for the actions available on the selection. */
  children: React.ReactNode;
  disabled?: boolean;
}

export interface DataToolbarSortProps<TSort extends string> {
  value: TSort;
  direction: SortDirection;
  options: readonly DataToolbarSortOption<TSort>[];
  onChange: (next: { sort: TSort; direction: SortDirection }) => void;
}

export interface DataToolbarViewProps<TView extends string> {
  value: TView;
  options: readonly DataToolbarViewOption<TView>[];
  onChange: (value: TView) => void;
}

export interface DataToolbarProps<TSort extends string, TView extends string> {
  search?: DataToolbarSearchProps;
  filters?: DataToolbarFiltersProps;
  bulkActions?: DataToolbarBulkActionsProps;
  sort?: DataToolbarSortProps<TSort>;
  view?: DataToolbarViewProps<TView>;
  /** Names the toolbar for assistive tech — "Gear list controls". */
  label: string;
  className?: string;
}

type SlotKey = "filters" | "search" | "bulk" | "sort" | "view";

export function DataToolbar<TSort extends string, TView extends string>({
  search,
  filters,
  bulkActions,
  sort,
  view,
  label,
  className,
}: DataToolbarProps<TSort, TView>) {
  // The bulk slot is present only while something is selected, so it
  // participates in the seam calculation conditionally too — otherwise
  // the sort button keeps a flat left edge against nothing.
  const showBulk = bulkActions !== undefined && bulkActions.selectedCount > 0;
  const slots: SlotKey[] = [
    ...(filters ? (["filters"] as const) : []),
    ...(search ? (["search"] as const) : []),
    ...(showBulk ? (["bulk"] as const) : []),
    ...(sort ? (["sort"] as const) : []),
    ...(view ? (["view"] as const) : []),
  ];

  const seamClass = (key: SlotKey) => {
    const index = slots.indexOf(key);
    return cn(
      index > 0 && "md:rounded-l-none md:border-l-0",
      index < slots.length - 1 && "md:rounded-r-none",
    );
  };

  return (
    // The app's only `TooltipProvider` is the one `SidebarProvider`
    // installs, so a toolbar rendered anywhere else — a test, a
    // Storybook story, a future signed-out list — would throw. Owning
    // one here keeps the component self-contained; nesting it inside
    // the sidebar's is harmless.
    <TooltipProvider delayDuration={300}>
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex flex-wrap items-stretch gap-2",
          "md:w-full md:flex-nowrap md:gap-0",
          // Segments overlap their borders once connected, so a focused
          // one has to rise above its neighbour for the ring to close.
          "[&>*]:focus-within:relative [&>*]:focus-within:z-10",
          className,
        )}
      >
        {filters ? (
          <FiltersSlot {...filters} className={seamClass("filters")} />
        ) : null}

        {search ? (
          <SearchSlot
            {...search}
            className={cn(
              // Own row on mobile, the elastic middle of the bar on desktop.
              "order-first w-full md:order-none md:w-auto md:min-w-0 md:flex-1",
              seamClass("search"),
            )}
          />
        ) : null}

        {showBulk ? (
          <BulkActionsSlot {...bulkActions} className={seamClass("bulk")} />
        ) : null}

        {sort ? <SortSlot {...sort} className={seamClass("sort")} /> : null}

        {view ? <ViewSlot {...view} className={seamClass("view")} /> : null}
      </div>
    </TooltipProvider>
  );
}

/** Shared geometry for the icon-only segments. An explicit `h-9`
 *  rather than `size="icon"` so every segment matches the InputGroup's
 *  height exactly — a 1px difference shows up as a step in the
 *  connected border. */
const SEGMENT = "h-9 shrink-0 px-2.5";

function CountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">
      {count}
    </span>
  );
}

function FiltersSlot({
  activeCount,
  onClear,
  children,
  className,
}: DataToolbarFiltersProps & { className?: string }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn(SEGMENT, className)}>
              <ListFilter className="size-4" />
              {activeCount > 0 ? <CountBadge count={activeCount} /> : null}
              <span className="sr-only">
                {activeCount > 0
                  ? `Filters (${activeCount} active)`
                  : "Filters"}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Filters</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] space-y-4"
      >
        {children}
        {activeCount > 0 && onClear ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onClear}
          >
            Clear filters
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SearchSlot({
  value,
  onChange,
  placeholder,
  className,
}: DataToolbarSearchProps & { className?: string }) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `onChange` is usually an inline arrow that navigates, so a new
  // identity arrives every render. Reading it from a ref keeps the
  // pending timer from having to be torn down and rebuilt each time,
  // which would mean a keystroke never settles on a busy page.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-sync when the committed value moves underneath us — a cleared
  // filter, a back navigation. After our own debounce fires this is a
  // no-op, since `value` arrives already equal to the draft.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const cancelPending = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const commitLater = (next: string) => {
    setDraft(next);
    cancelPending();
    timerRef.current = setTimeout(() => {
      onChangeRef.current(next);
    }, SEARCH_DEBOUNCE_MS);
  };

  const commitNow = (next: string) => {
    setDraft(next);
    cancelPending();
    onChangeRef.current(next);
  };

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <Search className="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={draft}
        placeholder={placeholder ?? "Search…"}
        aria-label={placeholder ?? "Search"}
        onChange={(e) => commitLater(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitNow(e.currentTarget.value);
          }
          if (e.key === "Escape" && draft.length > 0) {
            e.preventDefault();
            commitNow("");
          }
        }}
      />
      {draft.length > 0 ? (
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton size="icon-xs" onClick={() => commitNow("")}>
                <X className="size-3.5" />
                <span className="sr-only">Clear search</span>
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>Clear search</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function BulkActionsSlot({
  selectedCount,
  children,
  disabled,
  className,
}: DataToolbarBulkActionsProps & { className?: string }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              disabled={disabled}
              className={cn(SEGMENT, className)}
            >
              <CheckSquare className="size-4" />
              <CountBadge count={selectedCount} />
              <span className="sr-only">
                Bulk actions ({selectedCount} selected)
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Bulk actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {selectedCount} selected
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortSlot<TSort extends string>({
  value,
  direction,
  options,
  onChange,
  className,
}: DataToolbarSortProps<TSort> & { className?: string }) {
  const active = options.find((o) => o.value === value) ?? options[0];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className={cn(SEGMENT, className)}>
              <ArrowUpDown className="size-4" />
              <span className="sr-only">Sort: {active.label}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Sort</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        {/* Direction first, then the property — the order the control
         * reads aloud: "descending, by date added". Both radio groups
         * `preventDefault` on select so the menu stays open while the
         * user tries combinations. */}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Direction
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={direction}
          onValueChange={(next) =>
            onChange({ sort: value, direction: next as SortDirection })
          }
        >
          <DropdownMenuRadioItem
            value="asc"
            onSelect={(e) => e.preventDefault()}
          >
            <ArrowUp className="size-4" />
            {active.ascLabel ?? "Ascending"}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="desc"
            onSelect={(e) => e.preventDefault()}
          >
            <ArrowDown className="size-4" />
            {active.descLabel ?? "Descending"}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const picked = options.find((o) => o.value === next);
            onChange({
              sort: next as TSort,
              // Switching property adopts that property's natural
              // direction, so "Date added" doesn't land on oldest-first
              // just because the previous sort was A–Z.
              direction: picked?.defaultDirection ?? direction,
            });
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={(e) => e.preventDefault()}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewSlot<TView extends string>({
  value,
  options,
  onChange,
  className,
}: DataToolbarViewProps<TView> & { className?: string }) {
  const active = options.find((o) => o.value === value) ?? options[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className={cn(SEGMENT, className)}>
              {/* The trigger wears the *active* view's icon, so the
               * current mode is readable without opening the menu. */}
              <ActiveIcon className="size-4" />
              <span className="sr-only">View: {active.label}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          View as
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as TView)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

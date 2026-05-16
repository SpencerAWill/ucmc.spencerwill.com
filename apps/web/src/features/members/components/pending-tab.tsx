/**
 * The "Pending" tab content — new registrations awaiting an officer
 * decision. Owns the bulk-action toolbar, date-range filter, and
 * per-row approve/reject affordances. URL state (date range, page,
 * per-page) is owned by the calling route and threaded through props.
 */
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Check, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Checkbox } from "#/components/ui/checkbox";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";
import { pendingRegistrationsQueryOptions } from "#/features/members/api/queries";
import { useApproveRegistrations } from "#/features/members/api/use-approve-registrations";
import { useRejectRegistrations } from "#/features/members/api/use-reject-registrations";
import type { PendingRegistration } from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export interface PendingTabProps {
  from: string | undefined;
  to: string | undefined;
  perPage: number;
  page: number;
  onDateRangeChange: (from: string | undefined, to: string | undefined) => void;
  onPerPageChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export function PendingTab({
  from,
  to,
  perPage,
  page,
  onDateRangeChange,
  onPerPageChange,
  onPageChange,
}: PendingTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const offset = (page - 1) * perPage;

  const dateRange: DateRange | undefined =
    (from ?? to)
      ? {
          from: from ? parseISO(from) : undefined,
          to: to ? parseISO(to) : undefined,
        }
      : undefined;

  const setDateRange = (range: DateRange | undefined) => {
    onDateRangeChange(
      range?.from ? toISODate(range.from) : undefined,
      range?.to ? toISODate(range.to) : undefined,
    );
  };

  const { data, isLoading } = useQuery(
    pendingRegistrationsQueryOptions({ from, to, limit: perPage, offset }),
  );

  const registrations = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Bulk-mutation cache invalidation is owned by the hooks
  // (useApproveRegistrations/useRejectRegistrations); the call-site
  // callback only needs to clear the local selection.
  const onMutationSuccess = () => {
    setSelected(new Set());
  };

  const bulkApprove = useApproveRegistrations();
  const bulkReject = useRejectRegistrations();

  const isBulkPending = bulkApprove.isPending || bulkReject.isPending;
  const allSelected =
    registrations.length > 0 && selected.size === registrations.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(registrations.map((r) => r.userId)));
    }
  };

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const dateLabel = dateRange?.from
    ? dateRange.to
      ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`
      : `From ${format(dateRange.from, "MMM d, yyyy")}`
    : "All time";

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-9",
                "justify-start text-left font-normal",
                !dateRange?.from && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 size-4" />
              {dateLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DateRangeCalendar dateRange={dateRange} onSelect={setDateRange} />
            {dateRange?.from ? (
              <div className="border-t px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateRange(undefined)}
                >
                  Clear dates
                </Button>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : registrations.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              No pending registrations
              {dateRange?.from ? " in the selected date range" : ""}.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Toolbar: select-all + bulk actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={toggleAll}
              disabled={isBulkPending}
              aria-label="Select all"
            />
            <span className="flex-1 text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} of ${registrations.length} selected`
                : `${registrations.length} pending`}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isBulkPending || selected.size === 0}
                onClick={() =>
                  bulkReject.mutate([...selected], {
                    onSuccess: onMutationSuccess,
                  })
                }
              >
                {bulkReject.isPending
                  ? "Rejecting…"
                  : `Reject${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Button>
              <Button
                size="sm"
                disabled={isBulkPending || selected.size === 0}
                onClick={() =>
                  bulkApprove.mutate([...selected], {
                    onSuccess: onMutationSuccess,
                  })
                }
              >
                {bulkApprove.isPending
                  ? "Approving…"
                  : `Approve${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Button>
            </div>
          </div>

          {/* Registration list */}
          <ul className="divide-y rounded-lg border">
            {registrations.map((reg) => (
              <RegistrationRow
                key={reg.userId}
                registration={reg}
                isSelected={selected.has(reg.userId)}
                onToggle={() => toggle(reg.userId)}
                disabled={isBulkPending}
              />
            ))}
          </ul>

          <DataPagination
            page={page}
            totalPages={totalPages}
            total={total}
            perPage={perPage}
            perPageOptions={LIMIT_OPTIONS}
            onPageChange={onPageChange}
            onPerPageChange={onPerPageChange}
          />
        </>
      )}
    </div>
  );
}

function DateRangeCalendar({
  dateRange,
  onSelect,
}: {
  dateRange: DateRange | undefined;
  onSelect: (range: DateRange | undefined) => void;
}) {
  const today = new Date();
  const fiveMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);

  // Scroll the container to the bottom on mount so the current month
  // (rendered last) is in view when the popover opens.
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  return (
    <div ref={scrollRef} className="max-h-[22rem] overflow-y-auto">
      <Calendar
        mode="range"
        selected={dateRange}
        onSelect={onSelect}
        numberOfMonths={6}
        showOutsideDays={false}
        disabled={{ after: today }}
        classNames={{ months: "flex flex-col gap-4" }}
        startMonth={fiveMonthsAgo}
        endMonth={today}
        defaultMonth={today}
      />
    </div>
  );
}

function RegistrationRow({
  registration,
  isSelected,
  onToggle,
  disabled,
}: {
  registration: PendingRegistration;
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const approve = useApproveRegistrations();
  const reject = useRejectRegistrations();

  const rowPending = approve.isPending || reject.isPending;
  const name = registration.preferredName ?? registration.fullName;

  return (
    <li
      className={`flex items-start gap-3 px-3 py-3 transition-colors sm:items-center ${isSelected ? "bg-primary/5" : ""}`}
    >
      <div className="pt-0.5 sm:pt-0">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={disabled || rowPending}
          aria-label={`Select ${registration.email}`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          {name ? (
            <span className="truncate text-sm font-medium">{name}</span>
          ) : null}
          <span className="truncate text-sm text-muted-foreground">
            {registration.email}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {registration.hasProfile ? (
            registration.ucAffiliation ? (
              <span className="rounded bg-muted px-1.5 py-0.5 capitalize">
                {registration.ucAffiliation}
              </span>
            ) : null
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              No profile yet
            </span>
          )}
          <span>{formatDate(registration.createdAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={disabled || rowPending}
              onClick={() => reject.mutate([registration.userId])}
            >
              <X className="size-4" />
              <span className="sr-only">Reject</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reject</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
              disabled={disabled || rowPending}
              onClick={() => approve.mutate([registration.userId])}
            >
              <Check className="size-4" />
              <span className="sr-only">Approve</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Approve</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

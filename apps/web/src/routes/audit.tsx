import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { useCallback } from "react";
import type { DateRange } from "react-day-picker";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
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
import { auditEventsQueryOptions } from "#/features/audit/api/queries";
import { AuditCard } from "#/features/audit/components/audit-card";
import { AUDIT_ACTIONS } from "#/features/audit/server/audit-fns";
import { requirePermission } from "#/features/auth/guards";
import { cn } from "#/lib/utils";

const PER_PAGE_OPTIONS = ["25", "50", "100", "200"] as const;
const DEFAULT_PER_PAGE = 50;

const ALL_ACTIONS_VALUE = "__all__";

const auditSearchSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce
    .number()
    .int()
    .refine((n) => (PER_PAGE_OPTIONS as readonly string[]).includes(String(n)))
    .optional(),
});

export const Route = createFileRoute("/audit")({
  validateSearch: auditSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "audit:view");
  },
  component: AuditPage,
});

function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

// Inclusive `to` parses as start-of-day in local time; the server
// expects an exclusive upper bound, so we want the start of the
// NEXT calendar day. Use `addDays` rather than `+ 24h ms` because a
// fixed millisecond offset is wrong across DST transitions — the
// chosen day can be 23 or 25 hours long, and a flat +24h would
// either include an hour of the next day or drop the last hour of
// the chosen day. `addDays` does calendar arithmetic correctly.
function dateRangeToMs(
  from: string | undefined,
  to: string | undefined,
): { fromMs: number | undefined; toMs: number | undefined } {
  const fromMs = from ? parseISO(from).getTime() : undefined;
  const toMs = to ? addDays(parseISO(to), 1).getTime() : undefined;
  return { fromMs, toMs };
}

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const action = search.action;
  const page = search.page ?? 1;
  const perPage = search.perPage ?? DEFAULT_PER_PAGE;
  const { fromMs, toMs } = dateRangeToMs(search.from, search.to);

  const dateRange: DateRange | undefined =
    (search.from ?? search.to)
      ? {
          from: search.from ? parseISO(search.from) : undefined,
          to: search.to ? parseISO(search.to) : undefined,
        }
      : undefined;

  const setDateRange = (range: DateRange | undefined) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        from: range?.from ? toISODate(range.from) : undefined,
        to: range?.to ? toISODate(range.to) : undefined,
        page: undefined, // reset to first page on filter change
      }),
    });
  };

  const setAction = (value: string) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        action:
          value === ALL_ACTIONS_VALUE
            ? undefined
            : (value as (typeof AUDIT_ACTIONS)[number]),
        page: undefined,
      }),
    });
  };

  const setPerPage = (value: string) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        perPage: Number(value),
        page: undefined,
      }),
    });
  };

  const setPage = (p: number) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        page: p === 1 ? undefined : p,
      }),
    });
  };

  const clearAll = () => {
    void navigate({ search: {} });
  };

  const query = useQuery(
    auditEventsQueryOptions({
      action: action ?? null,
      fromMs: fromMs ?? null,
      toMs: toMs ?? null,
      page,
      perPage,
    }),
  );

  const total = query.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const entries = query.data?.entries ?? [];
  const hasFilters = Boolean(action ?? search.from ?? search.to);

  const dateLabel = dateRange?.from
    ? dateRange.to
      ? `${formatDateLabel(dateRange.from)} – ${formatDateLabel(dateRange.to)}`
      : `From ${formatDateLabel(dateRange.from)}`
    : "Any date";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only record of officer and admin actions: registration
          decisions, role changes, waiver attestations, landing-page edits,
          account deletions.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={action ?? ALL_ACTIONS_VALUE} onValueChange={setAction}>
          <SelectTrigger className="h-9 w-[18rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACTIONS_VALUE}>All action types</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-9 justify-start gap-2 font-normal",
                !dateRange && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="size-4" />
              {dateLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DateRangeCalendar dateRange={dateRange} onSelect={setDateRange} />
          </PopoverContent>
        </Popover>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-9 gap-1"
          >
            <X className="size-3.5" /> Clear filters
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t load audit events. Reload the page to try again.
        </p>
      ) : entries.length > 0 ? (
        <>
          <div className="space-y-3">
            {entries.map((entry) => (
              <AuditCard key={entry.id} entry={entry} />
            ))}
          </div>
          <DataPagination
            page={page}
            totalPages={totalPages}
            total={total}
            perPage={perPage}
            perPageOptions={PER_PAGE_OPTIONS}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
          />
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {hasFilters
                ? "No audit events match the current filters"
                : "No audit events yet"}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
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
  // Unlike the registrations queue (whose source rows are bounded by
  // the user-retention sweeps), the audit log is intentionally
  // retained beyond those windows and includes non-user events
  // (landing edits, role changes) that have no retention sweep at
  // all. Show three years of history so older incident reviews can
  // still navigate to the right month — picking an earlier date than
  // the table actually has is harmless (returns no rows).
  const startMonth = new Date(today.getFullYear() - 3, today.getMonth(), 1);

  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  return (
    <div ref={scrollRef} className="max-h-88 overflow-y-auto">
      <Calendar
        mode="range"
        selected={dateRange}
        onSelect={onSelect}
        numberOfMonths={6}
        showOutsideDays={false}
        disabled={{ after: today }}
        classNames={{ months: "flex flex-col gap-4" }}
        startMonth={startMonth}
        endMonth={today}
        defaultMonth={today}
      />
    </div>
  );
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

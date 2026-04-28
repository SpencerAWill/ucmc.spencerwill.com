import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { DateRange } from "react-day-picker";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Checkbox } from "#/components/ui/checkbox";
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
import { cn } from "#/lib/utils";
import { requirePermission } from "#/features/auth/guards";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  approveRegistrationsFn,
  listMembersFn,
  listPendingRegistrationsFn,
  rejectRegistrationsFn,
  unrejectMembersFn,
} from "#/server/auth/member-fns";
import type {
  MemberSummary,
  PendingRegistration,
} from "#/server/auth/member-fns";

const REGISTRATIONS_QUERY_KEY = ["members", "registrations"] as const;
const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

const registrationsSearchSchema = z.object({
  tab: z.enum(["pending", "rejected"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/registrations")({
  validateSearch: registrationsSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "registrations:approve");
  },
  component: RegistrationsPage,
});

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

function RegistrationsPage() {
  const { tab } = Route.useSearch();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("members:manage");
  const activeTab = tab ?? "pending";

  if (activeTab === "rejected" && canManage) {
    return <RejectedView />;
  }

  return <PendingView canManage={canManage} />;
}

function PendingView({ canManage }: { canManage: boolean }) {
  const { from, to, limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;
  const offset = (page - 1) * perPage;
  const limitStr = String(perPage);

  const dateRange: DateRange | undefined =
    (from ?? to)
      ? {
          from: from ? parseISO(from) : undefined,
          to: to ? parseISO(to) : undefined,
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

  const setLimit = (value: string) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        limit: Number(value),
        page: undefined, // reset to first page on limit change
      }),
    });
  };

  const setPage = (p: number) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        page: p === 1 ? undefined : p, // omit page=1 for cleaner URLs
      }),
    });
  };

  const queryKey = [...REGISTRATIONS_QUERY_KEY, from, to, limitStr, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listPendingRegistrationsFn({
        data: { from, to, limit: perPage, offset },
      }),
  });

  const registrations = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const invalidate = async () => {
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: REGISTRATIONS_QUERY_KEY });
  };

  const bulkApprove = useMutation({
    mutationFn: () =>
      approveRegistrationsFn({ data: { userIds: [...selected] } }),
    onSuccess: invalidate,
  });

  const bulkReject = useMutation({
    mutationFn: () =>
      rejectRegistrationsFn({ data: { userIds: [...selected] } }),
    onSuccess: invalidate,
  });

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <p className="text-sm text-muted-foreground">
          Approving grants the &ldquo;member&rdquo; role automatically.
        </p>
      </header>

      {/* Tab toggle */}
      {canManage ? <TabToggle active="pending" /> : null}

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
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No pending registrations
          {dateRange?.from ? " in the selected date range" : ""}.
        </div>
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
                onClick={() => bulkReject.mutate()}
              >
                {bulkReject.isPending
                  ? "Rejecting…"
                  : `Reject${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Button>
              <Button
                size="sm"
                disabled={isBulkPending || selected.size === 0}
                onClick={() => bulkApprove.mutate()}
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

          {/* Pagination + rows per page */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
                <span className="ml-1 hidden sm:inline">({total} total)</span>
              </span>
              <Select value={limitStr} onValueChange={setLimit}>
                <SelectTrigger className="h-8 w-[7rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </>
      )}
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
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: REGISTRATIONS_QUERY_KEY });

  const approve = useMutation({
    mutationFn: () =>
      approveRegistrationsFn({ data: { userIds: [registration.userId] } }),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: () =>
      rejectRegistrationsFn({ data: { userIds: [registration.userId] } }),
    onSuccess: invalidate,
  });

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
              onClick={() => reject.mutate()}
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
              onClick={() => approve.mutate()}
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

// ── Tab toggle ──────────────────────────────────────────────────────────

function TabToggle({ active }: { active: "pending" | "rejected" }) {
  const navigate = useNavigate({ from: Route.fullPath });

  const setTab = (tab: "pending" | "rejected") => {
    void navigate({
      search: {
        tab: tab === "pending" ? undefined : tab,
        // Reset pagination and filters when switching tabs.
        page: undefined,
        from: undefined,
        to: undefined,
      },
    });
  };

  return (
    <div className="flex gap-1 rounded-md border p-1">
      <Button
        variant={active === "pending" ? "secondary" : "ghost"}
        size="sm"
        className="flex-1"
        onClick={() => setTab("pending")}
      >
        Pending
      </Button>
      <Button
        variant={active === "rejected" ? "secondary" : "ghost"}
        size="sm"
        className="flex-1"
        onClick={() => setTab("rejected")}
      >
        Rejected
      </Button>
    </div>
  );
}

// ── Rejected view ───────────────────────────────────────────────────────

function RejectedView() {
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;
  const offset = (page - 1) * perPage;
  const limitStr = String(perPage);

  const setLimit = (value: string) => {
    void navigate({
      search: (prev) => ({ ...prev, limit: Number(value), page: undefined }),
    });
  };

  const setPage = (p: number) => {
    void navigate({
      search: (prev) => ({ ...prev, page: p === 1 ? undefined : p }),
    });
  };

  const queryKey = ["members", "registrations", "rejected", limitStr, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listMembersFn({
        data: {
          statuses: "rejected",
          sort: "newest",
          limit: perPage,
          offset,
        },
      }),
  });

  const members = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const invalidate = async () => {
    setSelected(new Set());
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: REGISTRATIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["members", "directory"] }),
    ]);
  };

  const bulkUnreject = useMutation({
    mutationFn: () => unrejectMembersFn({ data: { userIds: [...selected] } }),
    onSuccess: invalidate,
  });

  const allSelected = members.length > 0 && selected.size === members.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(members.map((m) => m.userId)));
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <p className="text-sm text-muted-foreground">
          Un-rejecting moves users back to the pending queue.
        </p>
      </header>

      <TabToggle active="rejected" />

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No rejected registrations.
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={toggleAll}
              disabled={bulkUnreject.isPending}
              aria-label="Select all"
            />
            <span className="flex-1 text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} of ${members.length} selected`
                : `${members.length} rejected`}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkUnreject.isPending || selected.size === 0}
              onClick={() => bulkUnreject.mutate()}
            >
              <Undo2 className="mr-1 size-3.5" />
              {bulkUnreject.isPending
                ? "Moving..."
                : `Un-reject${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </div>

          {/* Rejected list */}
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <RejectedRow
                key={member.userId}
                member={member}
                isSelected={selected.has(member.userId)}
                onToggle={() => toggle(member.userId)}
                disabled={bulkUnreject.isPending}
                onSuccess={invalidate}
              />
            ))}
          </ul>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
                <span className="ml-1 hidden sm:inline">({total} total)</span>
              </span>
              <Select value={limitStr} onValueChange={setLimit}>
                <SelectTrigger className="h-8 w-[7rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RejectedRow({
  member,
  isSelected,
  onToggle,
  disabled,
  onSuccess,
}: {
  member: MemberSummary;
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
  onSuccess: () => Promise<void>;
}) {
  const unreject = useMutation({
    mutationFn: () => unrejectMembersFn({ data: { userIds: [member.userId] } }),
    onSuccess,
  });

  const name = member.preferredName ?? member.fullName;

  return (
    <li
      className={`flex items-center gap-3 px-3 py-3 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        disabled={disabled || unreject.isPending}
        aria-label={`Select ${member.email}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          {name ? (
            <span className="truncate text-sm font-medium">{name}</span>
          ) : null}
          <span className="truncate text-sm text-muted-foreground">
            {member.email}
          </span>
        </div>
        {member.ucAffiliation ? (
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 capitalize">
              {member.ucAffiliation}
            </span>
          </div>
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={disabled || unreject.isPending}
            onClick={() => unreject.mutate()}
          >
            <Undo2 className="size-4" />
            <span className="sr-only">Un-reject</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move to pending</TooltipContent>
      </Tooltip>
    </li>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Check, RotateCcw, Undo2, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { DateRange } from "react-day-picker";
import { z } from "zod";

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
import {
  RETENTION_DEACTIVATED_COPY,
  RETENTION_REJECTED_COPY,
} from "#/config/legal";
import { cn } from "#/lib/utils";
import { requirePermission } from "#/features/auth/guards";
import { MEMBERS_DIRECTORY_QUERY_KEY } from "#/features/members/api/query-keys";
import {
  lifecycleMembersQueryOptions,
  pendingRegistrationsQueryOptions,
} from "#/features/members/api/queries";
import { useApproveRegistrations } from "#/features/members/api/use-approve-registrations";
import { useReactivateMembers } from "#/features/members/api/use-reactivate-members";
import { useRejectRegistrations } from "#/features/members/api/use-reject-registrations";
import { useUnrejectMembers } from "#/features/members/api/use-unreject-members";
import { UnclaimedTab } from "#/features/members/components/unclaimed-tab";
import type {
  MemberSummary,
  PendingRegistration,
} from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

// Single source of truth for the tab id union — `validateSearch` and
// every helper that switches on the active tab read from here so adding
// or renaming a tab is a one-line change.
const tabIdSchema = z.enum(["pending", "unclaimed", "rejected", "deactivated"]);
type TabId = z.infer<typeof tabIdSchema>;

const managementSearchSchema = z.object({
  tab: tabIdSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/management")({
  validateSearch: managementSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "members:manage");
  },
  component: ManagementPage,
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

// Per-tab subtitle text rendered below the tabs. Lives at the parent
// level so the H1 + TabToggle stay anchored as the tab changes — only
// the description + content below the tabs reflow. Each entry leads
// with what the status *is* (so the tab is self-explanatory), then the
// action that this tab affords.
const TAB_DESCRIPTIONS: Record<TabId, string> = {
  pending:
    'New registrations awaiting an officer’s decision. Approving grants the "member" role automatically.',
  unclaimed:
    "Real-world members an officer pre-added so off-platform records (gear, attendance) can reference a stable account before the person ever signs in. They claim the row by clicking their first magic link.",
  rejected: `Registrations an officer declined. Un-rejecting moves users back to the pending queue. ${RETENTION_REJECTED_COPY}`,
  deactivated: `Approved members an officer turned off — sessions revoked, role removed, hidden from the directory. Reactivating restores the member role. ${RETENTION_DEACTIVATED_COPY}`,
};

function ManagementPage() {
  const { tab } = Route.useSearch();
  const activeTab: TabId = tab ?? "pending";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold">Member management</h1>
      </header>

      <TabToggle active={activeTab} />

      <p className="text-sm text-muted-foreground">
        {TAB_DESCRIPTIONS[activeTab]}
      </p>

      {activeTab === "pending" ? <PendingView /> : null}
      {activeTab === "unclaimed" ? <UnclaimedView /> : null}
      {/* `key={activeTab}` forces React to unmount + remount when the
          user toggles between rejected and deactivated. Same component
          type at the same tree position would otherwise reuse the
          instance and carry the previous tab's `selected` Set across —
          stale userIds would render in the toolbar count and seed the
          bulk button. */}
      {activeTab === "rejected" || activeTab === "deactivated" ? (
        <LifecycleView key={activeTab} status={activeTab} />
      ) : null}
    </div>
  );
}

// ── Unclaimed view ──────────────────────────────────────────────────────

function UnclaimedView() {
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;

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

  return (
    <UnclaimedTab
      perPage={perPage}
      page={page}
      onPerPageChange={setLimit}
      onPageChange={setPage}
    />
  );
}

// ── Pending view ────────────────────────────────────────────────────────

function PendingView() {
  const { from, to, limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;
  const offset = (page - 1) * perPage;

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
            onPageChange={setPage}
            onPerPageChange={setLimit}
          />
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

// ── Tab toggle ──────────────────────────────────────────────────────────

const TAB_LABELS: Record<TabId, string> = {
  pending: "Pending",
  unclaimed: "Unclaimed",
  rejected: "Rejected",
  deactivated: "Deactivated",
};

function TabToggle({ active }: { active: TabId }) {
  const navigate = useNavigate({ from: Route.fullPath });

  const setTab = (tab: TabId) => {
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
    // On phones the four tabs don't fit on one row without the labels
    // truncating ("Deactivated" alone needs ~90 px); a 2×2 grid keeps
    // every label legible. From `sm` (640 px) on, fall back to a single
    // flex row.
    <div className="grid grid-cols-2 gap-1 rounded-md border p-1 sm:flex">
      {tabIdSchema.options.map((tab) => (
        <Button
          key={tab}
          variant={active === tab ? "secondary" : "ghost"}
          size="sm"
          className="sm:flex-1"
          onClick={() => setTab(tab)}
        >
          {TAB_LABELS[tab]}
        </Button>
      ))}
    </div>
  );
}

// ── Lifecycle view (rejected + deactivated) ─────────────────────────────

interface LifecycleConfig {
  emptyTitle: string;
  countNoun: string;
  bulkLabel: string;
  bulkPendingLabel: string;
  rowTooltip: string;
  rowSrLabel: string;
  icon: typeof Undo2;
}

const LIFECYCLE_CONFIG: Record<
  Extract<TabId, "rejected" | "deactivated">,
  LifecycleConfig
> = {
  rejected: {
    emptyTitle: "No rejected registrations.",
    countNoun: "rejected",
    bulkLabel: "Un-reject",
    bulkPendingLabel: "Moving...",
    rowTooltip: "Move to pending",
    rowSrLabel: "Un-reject",
    icon: Undo2,
  },
  deactivated: {
    emptyTitle: "No deactivated members.",
    countNoun: "deactivated",
    bulkLabel: "Reactivate",
    bulkPendingLabel: "Reactivating...",
    rowTooltip: "Reactivate",
    rowSrLabel: "Reactivate",
    icon: RotateCcw,
  },
};

function LifecycleView({
  status,
}: {
  status: Extract<TabId, "rejected" | "deactivated">;
}) {
  const config = LIFECYCLE_CONFIG[status];
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;
  const offset = (page - 1) * perPage;

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

  const { data, isLoading } = useQuery(
    lifecycleMembersQueryOptions(status, { limit: perPage, offset }),
  );

  const members = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // The lifecycle mutations (useUnrejectMembers, useReactivateMembers)
  // both invalidate MEMBERS_REGISTRATIONS_QUERY_KEY by prefix, which
  // covers this list. Add a directory invalidation so an unrejected /
  // reactivated member appears there immediately too.
  const onMutationSuccess = async () => {
    setSelected(new Set());
    await queryClient.invalidateQueries({
      queryKey: MEMBERS_DIRECTORY_QUERY_KEY,
    });
  };

  // Both lifecycle hooks must be called unconditionally to satisfy the
  // rules of hooks. Pick the right one for the active tab.
  const unreject = useUnrejectMembers();
  const reactivate = useReactivateMembers();
  const bulkMutation = status === "rejected" ? unreject : reactivate;

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

  const Icon = config.icon;

  return (
    <div className="flex flex-col gap-6">
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : members.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{config.emptyTitle}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={toggleAll}
              disabled={bulkMutation.isPending}
              aria-label="Select all"
            />
            <span className="flex-1 text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} of ${members.length} selected`
                : `${members.length} ${config.countNoun}`}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkMutation.isPending || selected.size === 0}
              onClick={() =>
                bulkMutation.mutate([...selected], {
                  onSuccess: onMutationSuccess,
                })
              }
            >
              <Icon className="mr-1 size-3.5" />
              {bulkMutation.isPending
                ? config.bulkPendingLabel
                : `${config.bulkLabel}${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </div>

          {/* Member list */}
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <LifecycleRow
                key={member.userId}
                status={status}
                member={member}
                isSelected={selected.has(member.userId)}
                onToggle={() => toggle(member.userId)}
                disabled={bulkMutation.isPending}
                config={config}
                onSuccess={onMutationSuccess}
              />
            ))}
          </ul>

          <DataPagination
            page={page}
            totalPages={totalPages}
            total={total}
            perPage={perPage}
            perPageOptions={LIMIT_OPTIONS}
            onPageChange={setPage}
            onPerPageChange={setLimit}
          />
        </>
      )}
    </div>
  );
}

function LifecycleRow({
  status,
  member,
  isSelected,
  onToggle,
  disabled,
  config,
  onSuccess,
}: {
  status: Extract<TabId, "rejected" | "deactivated">;
  member: MemberSummary;
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
  config: LifecycleConfig;
  onSuccess: () => Promise<void>;
}) {
  const unreject = useUnrejectMembers();
  const reactivate = useReactivateMembers();
  const mutation = status === "rejected" ? unreject : reactivate;
  const Icon = config.icon;
  const name = member.preferredName ?? member.fullName;

  return (
    <li
      className={`flex items-center gap-3 px-3 py-3 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        disabled={disabled || mutation.isPending}
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
            disabled={disabled || mutation.isPending}
            onClick={() => mutation.mutate([member.userId], { onSuccess })}
          >
            <Icon className="size-4" />
            <span className="sr-only">{config.rowSrLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{config.rowTooltip}</TooltipContent>
      </Tooltip>
    </li>
  );
}

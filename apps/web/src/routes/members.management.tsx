import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import {
  RETENTION_DEACTIVATED_COPY,
  RETENTION_REJECTED_COPY,
} from "#/config/legal";
import { requirePermission } from "#/features/auth/guards";
import { LifecycleTab } from "#/features/members/components/lifecycle-tab";
import { PendingTab } from "#/features/members/components/pending-tab";
import { UnclaimedTab } from "#/features/members/components/unclaimed-tab";

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
  const {
    tab,
    from,
    to,
    limit: searchLimit,
    page: searchPage,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeTab: TabId = tab ?? "pending";

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

  const setDateRange = (
    nextFrom: string | undefined,
    nextTo: string | undefined,
  ) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        from: nextFrom,
        to: nextTo,
        page: undefined, // reset to first page on filter change
      }),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold">Member management</h1>
      </header>

      <TabToggle active={activeTab} />

      <p className="text-sm text-muted-foreground">
        {TAB_DESCRIPTIONS[activeTab]}
      </p>

      {activeTab === "pending" ? (
        <PendingTab
          from={from}
          to={to}
          perPage={perPage}
          page={page}
          onDateRangeChange={setDateRange}
          onPerPageChange={setLimit}
          onPageChange={setPage}
        />
      ) : null}
      {activeTab === "unclaimed" ? (
        <UnclaimedTab
          perPage={perPage}
          page={page}
          onPerPageChange={setLimit}
          onPageChange={setPage}
        />
      ) : null}
      {/* `key={activeTab}` forces React to unmount + remount when the
          user toggles between rejected and deactivated. Same component
          type at the same tree position would otherwise reuse the
          instance and carry the previous tab's `selected` Set across —
          stale userIds would render in the toolbar count and seed the
          bulk button. */}
      {activeTab === "rejected" || activeTab === "deactivated" ? (
        <LifecycleTab
          key={activeTab}
          kind={activeTab}
          perPage={perPage}
          page={page}
          onPerPageChange={setLimit}
          onPageChange={setPage}
        />
      ) : null}
    </div>
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

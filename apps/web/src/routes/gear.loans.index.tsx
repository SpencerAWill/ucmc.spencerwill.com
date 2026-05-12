import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { DataPagination } from "#/components/data-pagination";
import { Button } from "#/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";
import {
  loansListQueryOptions,
  memberForLoanByPublicIdQueryOptions,
} from "#/features/gear/api/queries";
import { GearDeskTrigger } from "#/features/gear/components/gear-desk-trigger";
import { LoanCard } from "#/features/gear/components/loan-card";
import { LoanFilterBar } from "#/features/gear/components/loan-filter-bar";
import type { LoanFilterState } from "#/features/gear/components/loan-filter-bar";
import { LoansBulkImportSheet } from "#/features/gear/components/loans-bulk-import-sheet";

// Matches the perPage choices on /gear and /audit so the muscle
// memory carries between officer-facing list pages. Defaults to 50.
const PER_PAGE_OPTIONS = ["25", "50", "100", "250"] as const;
const DEFAULT_PER_PAGE = 50;

const loansSearchSchema = z.object({
  tab: z.enum(["active", "history"]).optional(),
  q: z.string().optional(),
  member: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  sort: z.enum(["due_at", "checked_out_at"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  // Pin to the offered choices so a URL with `?perPage=37` doesn't
  // leave the Select trigger with an unmatched value. Out-of-range
  // input falls back to the default at the consumer.
  perPage: z.coerce
    .number()
    .int()
    .refine((n) => (PER_PAGE_OPTIONS as readonly string[]).includes(String(n)))
    .optional(),
});

export const Route = createFileRoute("/gear/loans/")({
  validateSearch: loansSearchSchema,
  beforeLoad: async ({ context }) => {
    // Gate on `gear:loan` so non-officers don't even see the loader
    // fire — the action layer would also reject, but the redirect
    // here keeps the URL clean.
    await requirePermission(context.queryClient, "gear:loan");
  },
  component: GearLoansPage,
});

function GearLoansPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { hasPermission } = useAuth();
  const canLoan = hasPermission("gear:loan");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // URL is the source of truth for the member filter — only the
  // publicId is shareable. The full member object (name, email) is
  // resolved through a query keyed on that publicId. This makes a
  // refresh + deep-link rehydrate the filter chip correctly without
  // any local-state mirror to keep in sync.
  const { data: selectedMember = null } = useQuery(
    memberForLoanByPublicIdQueryOptions(search.member ?? null),
  );

  const filterState: LoanFilterState = {
    tab: search.tab ?? "active",
    q: search.q ?? "",
    overdueOnly: search.overdue ?? false,
    sort: search.sort ?? "due_at",
    selectedMember,
  };

  const onFilterChange = (next: LoanFilterState) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        tab: next.tab === "active" ? undefined : next.tab,
        q: next.q.trim().length === 0 ? undefined : next.q.trim(),
        overdue: next.overdueOnly ? true : undefined,
        sort: next.sort === "due_at" ? undefined : next.sort,
        member: next.selectedMember?.publicId ?? undefined,
        page: undefined,
      }),
    });
  };

  const page = search.page ?? 1;
  const perPage = search.perPage ?? DEFAULT_PER_PAGE;

  const { data, isLoading } = useQuery(
    loansListQueryOptions({
      tab: filterState.tab,
      memberPublicId: search.member,
      q: search.q,
      overdueOnly: filterState.overdueOnly,
      sort: filterState.sort,
      page,
      perPage,
    }),
  );
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
          <p className="text-sm text-muted-foreground">
            Checkouts and check-ins at the gear cave.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canLoan ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkImportOpen(true)}
            >
              <Upload className="size-4" />
              <span className="hidden sm:inline">Backfill</span>
            </Button>
          ) : null}
          <GearDeskTrigger canLoan={canLoan} />
        </div>
      </header>
      {canLoan ? (
        <LoansBulkImportSheet
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
        />
      ) : null}
      <LoanFilterBar state={filterState} onChange={onFilterChange} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading loans…</p>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {filterState.tab === "active"
                ? "No active loans."
                : "No loan history yet."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((loan) => (
            <LoanCard key={loan.publicId} loan={loan} />
          ))}
        </ul>
      )}
      {/* Always rendered when there's at least one row — same
          convention as /gear and /audit. The component handles the
          single-page case itself (disabled prev/next, "Page 1 of 1")
          rather than us hiding it; that way the perPage picker stays
          available even before the list overflows one page. */}
      {rows.length > 0 ? (
        <DataPagination
          page={page}
          perPage={perPage}
          total={total}
          totalPages={totalPages}
          perPageOptions={PER_PAGE_OPTIONS}
          onPageChange={(p) =>
            navigate({
              search: (prev) => ({
                ...prev,
                page: p === 1 ? undefined : p,
              }),
            })
          }
          onPerPageChange={(pp) =>
            navigate({
              search: (prev) => ({
                ...prev,
                perPage: Number.parseInt(pp, 10),
                page: undefined,
              }),
            })
          }
        />
      ) : null}
    </div>
  );
}

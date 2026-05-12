import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";
import { loansListQueryOptions } from "#/features/gear/api/queries";
import { GearDeskTrigger } from "#/features/gear/components/gear-desk-trigger";
import { LoanCard } from "#/features/gear/components/loan-card";
import { LoanFilterBar } from "#/features/gear/components/loan-filter-bar";
import type { LoanFilterState } from "#/features/gear/components/loan-filter-bar";
import type { MemberSearchResult } from "#/features/gear/server/gear-fns";

const loansSearchSchema = z.object({
  tab: z.enum(["active", "history"]).optional(),
  q: z.string().optional(),
  member: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  sort: z.enum(["due_at", "checked_out_at"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(250).optional(),
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

  // The MemberSearchCombobox is fully controlled — to keep its label
  // populated, we mirror the picker's selected member into component
  // state alongside the URL. URL holds the publicId for shareability;
  // local state holds the full object for label rendering. Deep-link
  // visitors arriving with `?member=...` see a filter applied but the
  // picker shows blank until they re-pick (acceptable; primary use
  // case is officer browsing-and-picking, not deep-linking).
  const [selectedMember, setSelectedMember] =
    useState<MemberSearchResult | null>(null);

  const filterState: LoanFilterState = {
    tab: search.tab ?? "active",
    q: search.q ?? "",
    overdueOnly: search.overdue ?? false,
    sort: search.sort ?? "due_at",
    selectedMember,
  };

  const onFilterChange = (next: LoanFilterState) => {
    setSelectedMember(next.selectedMember);
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
  const perPage = search.perPage ?? 50;

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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
          <p className="text-sm text-muted-foreground">
            Checkouts and check-ins at the gear cave.
          </p>
        </div>
        <GearDeskTrigger canLoan={canLoan} />
      </header>
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
      {total > perPage ? (
        <DataPagination
          page={page}
          perPage={perPage}
          total={total}
          totalPages={Math.max(1, Math.ceil(total / perPage))}
          perPageOptions={["25", "50", "100"] as const}
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

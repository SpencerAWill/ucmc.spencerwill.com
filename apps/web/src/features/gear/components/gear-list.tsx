import { useQuery } from "@tanstack/react-query";

import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { gearListQueryOptions } from "#/features/gear/api/queries";
import { GearCard } from "#/features/gear/components/gear-card";
import type { GearView } from "#/features/gear/components/gear-filter-bar";
import { GearGridCard } from "#/features/gear/components/gear-grid-card";
import { GearTableView } from "#/features/gear/components/gear-table-view";
import type {
  GearSummary,
  ListGearActionInput,
} from "#/features/gear/server/gear-fns";

const PER_PAGE_OPTIONS = ["25", "50", "100", "250"] as const;

export function GearList({
  input,
  view,
  canManage,
  onEdit,
  onRetire,
  onUnretire,
  onPageChange,
  onPerPageChange,
}: {
  input: ListGearActionInput;
  view: GearView;
  canManage: boolean;
  onEdit: (gear: GearSummary) => void;
  onRetire: (gear: GearSummary) => void;
  onUnretire: (gear: GearSummary) => void;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  const { data, isLoading } = useQuery(gearListQueryOptions(input));
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? input.page ?? 1;
  const perPage = data?.perPage ?? input.perPage ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No gear matches the current filters.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="space-y-3">
      {view === "list" ? (
        <ul className="space-y-2">
          {rows.map((g) => (
            <li key={g.publicId}>
              <GearCard
                gear={g}
                canManage={canManage}
                onEdit={() => onEdit(g)}
                onRetire={() => onRetire(g)}
                onUnretire={() => onUnretire(g)}
              />
            </li>
          ))}
        </ul>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((g) => (
            <GearGridCard
              key={g.publicId}
              gear={g}
              canManage={canManage}
              onEdit={() => onEdit(g)}
              onRetire={() => onRetire(g)}
              onUnretire={() => onUnretire(g)}
            />
          ))}
        </div>
      ) : (
        <GearTableView
          rows={rows}
          canManage={canManage}
          onEdit={onEdit}
          onRetire={onRetire}
          onUnretire={onUnretire}
        />
      )}
      <DataPagination
        page={page}
        totalPages={totalPages}
        total={total}
        perPage={perPage}
        perPageOptions={PER_PAGE_OPTIONS}
        onPageChange={onPageChange}
        onPerPageChange={(s) => onPerPageChange(Number.parseInt(s, 10))}
      />
    </div>
  );
}

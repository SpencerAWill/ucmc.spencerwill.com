/**
 * The "Rejected" and "Deactivated" tabs share this list-with-bulk-action
 * shape; the `kind` prop picks the right copy, icon, and mutation. The
 * caller is expected to remount the component when `kind` changes (so
 * the local selection state doesn't leak across statuses).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { MEMBERS_DIRECTORY_QUERY_KEY } from "#/features/members/api/query-keys";
import { lifecycleMembersQueryOptions } from "#/features/members/api/queries";
import { useReactivateMembers } from "#/features/members/api/use-reactivate-members";
import { useUnrejectMembers } from "#/features/members/api/use-unreject-members";
import type { MemberSummary } from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

export type LifecycleKind = "rejected" | "deactivated";

interface LifecycleConfig {
  emptyTitle: string;
  countNoun: string;
  bulkLabel: string;
  bulkPendingLabel: string;
  rowTooltip: string;
  rowSrLabel: string;
  icon: typeof Undo2;
}

const LIFECYCLE_CONFIG: Record<LifecycleKind, LifecycleConfig> = {
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

export interface LifecycleTabProps {
  kind: LifecycleKind;
  perPage: number;
  page: number;
  onPerPageChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export function LifecycleTab({
  kind,
  perPage,
  page,
  onPerPageChange,
  onPageChange,
}: LifecycleTabProps) {
  const config = LIFECYCLE_CONFIG[kind];
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const offset = (page - 1) * perPage;

  const { data, isLoading } = useQuery(
    lifecycleMembersQueryOptions(kind, { limit: perPage, offset }),
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
  const bulkMutation = kind === "rejected" ? unreject : reactivate;

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
                kind={kind}
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
            onPageChange={onPageChange}
            onPerPageChange={onPerPageChange}
          />
        </>
      )}
    </div>
  );
}

function LifecycleRow({
  kind,
  member,
  isSelected,
  onToggle,
  disabled,
  config,
  onSuccess,
}: {
  kind: LifecycleKind;
  member: MemberSummary;
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
  config: LifecycleConfig;
  onSuccess: () => Promise<void>;
}) {
  const unreject = useUnrejectMembers();
  const reactivate = useReactivateMembers();
  const mutation = kind === "rejected" ? unreject : reactivate;
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

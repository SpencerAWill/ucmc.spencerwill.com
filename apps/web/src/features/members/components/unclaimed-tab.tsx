/**
 * The "Unclaimed" tab on `/members/management`. Lists officer-pre-
 * added stub members, exposes the bulk pre-add sheet, and provides
 * per-row edit + bulk-delete affordances.
 */
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { unclaimedMembersQueryOptions } from "#/features/members/api/queries";
import { useDeleteUnclaimed } from "#/features/members/api/use-delete-unclaimed";
import { EditUnclaimedDialog } from "#/features/members/components/edit-unclaimed-dialog";
import { PreAddUnclaimedSheet } from "#/features/members/components/pre-add-unclaimed-sheet";
import type { UnclaimedMember } from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface UnclaimedTabProps {
  perPage: number;
  page: number;
  onPerPageChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export function UnclaimedTab({
  perPage,
  page,
  onPerPageChange,
  onPageChange,
}: UnclaimedTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UnclaimedMember | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    members: UnclaimedMember[];
  } | null>(null);

  const offset = (page - 1) * perPage;
  const { data, isLoading } = useQuery(
    unclaimedMembersQueryOptions({ limit: perPage, offset }),
  );
  const members = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const deleteMutation = useDeleteUnclaimed();

  const allSelected = members.length > 0 && selected.size === members.length;
  const someSelected = selected.size > 0 && !allSelected;
  const isBusy = deleteMutation.isPending;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(members.map((m) => m.userId)));
    }
  }

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  function openBulkDelete() {
    const targets = members.filter((m) => selected.has(m.userId));
    if (targets.length > 0) {
      setConfirmDelete({ members: targets });
    }
  }

  function openSingleDelete(member: UnclaimedMember) {
    setConfirmDelete({ members: [member] });
  }

  async function performDelete() {
    if (!confirmDelete) return;
    const ids = confirmDelete.members.map((m) => m.userId);
    await deleteMutation.mutateAsync(ids);
    setSelected(new Set());
    setConfirmDelete(null);
  }

  return (
    <>
      {/* Toolbar — always visible so the "Pre-add" button is reachable
          even when the list is empty. */}
      <div className="flex flex-wrap items-center gap-3">
        {members.length > 0 ? (
          <>
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={toggleAll}
              disabled={isBusy}
              aria-label="Select all"
            />
            <span className="flex-1 text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} of ${members.length} selected`
                : `${members.length} unclaimed`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || selected.size === 0}
              onClick={openBulkDelete}
            >
              {deleteMutation.isPending
                ? "Removing…"
                : `Remove${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">
            No unclaimed members yet.
          </span>
        )}
        <Button type="button" size="sm" onClick={() => setSheetOpen(true)}>
          <Plus className="size-4" />
          Pre-add members
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : members.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No unclaimed members.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <UnclaimedRow
                key={member.userId}
                member={member}
                isSelected={selected.has(member.userId)}
                onToggle={() => toggle(member.userId)}
                onEdit={() => setEditTarget(member)}
                onDelete={() => openSingleDelete(member)}
                disabled={isBusy}
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

      <PreAddUnclaimedSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      <EditUnclaimedDialog
        member={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.members.length === 1
                ? `Remove ${confirmDelete.members[0]?.placeholderName}?`
                : `Remove ${confirmDelete?.members.length} unclaimed members?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              These rows have not been claimed by their owners yet. Any gear or
              other records you&apos;ve associated with them will lose their
              reference. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void performDelete();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function UnclaimedRow({
  member,
  isSelected,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: {
  member: UnclaimedMember;
  isSelected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-3 px-3 py-3 transition-colors sm:items-center ${
        isSelected ? "bg-primary/5" : ""
      }`}
    >
      <div className="pt-0.5 sm:pt-0">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={disabled}
          aria-label={`Select ${member.email}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="truncate text-sm font-medium">
            {member.placeholderName}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {member.email}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">Unclaimed</span>
          <span>Added {formatDate(member.unclaimedAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled}
              onClick={onEdit}
            >
              <Pencil className="size-4" />
              <span className="sr-only">Edit</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={disabled}
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Remove</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

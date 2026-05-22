import { Pencil, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { HonoraryEntry } from "#/features/history/server/history-fns";

/**
 * Flat list of honorary UCMC members. Honorary membership is granted
 * by majority voting-member vote per Constitution §3.4. The list is
 * small and changes rarely; alphabetical sort by display order is
 * preserved from the legacy site rather than re-sorted in code.
 *
 * When `canManage` is true, each row decorates with pencil + trash
 * buttons that emit callbacks to the parent (which hosts the
 * edit-dialog and delete-confirm state).
 */
export function HonoraryMembers({
  members,
  canManage = false,
  onEdit,
  onDelete,
}: {
  members: HonoraryEntry[];
  canManage?: boolean;
  onEdit?: (member: HonoraryEntry, sortOrder: number) => void;
  onDelete?: (member: HonoraryEntry) => void;
}) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No honorary members on record yet.
      </p>
    );
  }
  return (
    <ul
      className={
        canManage
          ? "divide-y divide-border/60 rounded-md border border-border/60 bg-card/40 text-sm"
          : "grid grid-cols-1 gap-1 text-sm sm:grid-cols-2"
      }
    >
      {members.map((member, idx) => {
        // `sortOrder` is the 1-indexed slot derived from server
        // ordering; honoraryEntries don't carry the value on the wire.
        const sortOrder = idx + 1;
        if (canManage) {
          return (
            <li
              key={member.id}
              className="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <p className="truncate">{member.name}</p>
              <div className="flex gap-1">
                {onEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Edit ${member.name}`}
                    onClick={() => onEdit(member, sortOrder)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Delete ${member.name}`}
                    onClick={() => onDelete(member)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        }
        return <li key={member.id}>{member.name}</li>;
      })}
    </ul>
  );
}

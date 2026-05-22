import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "#/components/ui/sortable";
import { useReorderHonoraryMembers } from "#/features/history/api/use-honorary-member-mutations";
import type { HonoraryEntry } from "#/features/history/server/history-fns";

/**
 * Flat list of honorary UCMC members. Honorary membership is granted
 * by majority voting-member vote per Constitution §3.4.
 *
 * Read-only viewers see a tight two-column grid in display order.
 * `history:manage` holders see a draggable list — grab the
 * `GripVertical` handle on any row to reorder; each drop fires a
 * batch sort_order rewrite on the server. The dialog edit form
 * dropped its sort-order number input now that DnD is the way to
 * change ordering. Pencil + trash on each row open the parent's
 * edit dialog / delete confirm.
 */
export function HonoraryMembers({
  members,
  canManage = false,
  onEdit,
  onDelete,
}: {
  members: HonoraryEntry[];
  canManage?: boolean;
  onEdit?: (member: HonoraryEntry) => void;
  onDelete?: (member: HonoraryEntry) => void;
}) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No honorary members on record yet.
      </p>
    );
  }
  if (!canManage) {
    // Two-column grid keeps the canonical-order list compact while
    // notes (when present) sit on a second line in muted italics
    // underneath the name. Members without notes render as a single
    // line.
    return (
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {members.map((m) => (
          <li key={m.id}>
            <p>{m.name}</p>
            {m.notes ? (
              <p className="text-xs italic text-muted-foreground">{m.notes}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <SortableHonoraryList
      members={members}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function SortableHonoraryList({
  members,
  onEdit,
  onDelete,
}: {
  members: HonoraryEntry[];
  onEdit?: (member: HonoraryEntry) => void;
  onDelete?: (member: HonoraryEntry) => void;
}) {
  const reorder = useReorderHonoraryMembers();

  // Local optimistic copy of `members` so the UI snaps to the new
  // order on drop without waiting for the server round-trip. The
  // effect resyncs whenever the id-set or order from props changes
  // (server invalidation after add / delete / parallel-tab edit) by
  // diffing the joined ids — a deep equality check would be heavier
  // for the same outcome.
  const [items, setItems] = useState<HonoraryEntry[]>(members);
  const idsKey = members.map((m) => m.id).join(",");
  // `idsKey` (not `members`) is the dependency on purpose: we only want
  // to resync when the actual ordering or membership of the list
  // changes server-side, not on every parent re-render that happens to
  // pass a new array reference with the same contents.
  useEffect(() => {
    setItems(members);
  }, [idsKey, members]);

  async function handleReorder(next: HonoraryEntry[]) {
    setItems(next);
    try {
      await reorder.mutateAsync({ ids: next.map((m) => m.id) });
    } catch (err) {
      // Revert to last-known server state and surface the error.
      setItems(members);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the new order.",
      );
    }
  }

  return (
    <Sortable
      value={items}
      onValueChange={(next) => void handleReorder(next)}
      getItemValue={(m) => m.id}
    >
      <SortableContent asChild>
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/40 text-sm">
          {items.map((member) => (
            <SortableItem key={member.id} value={member.id} asChild>
              <li className="flex items-center gap-2 px-3 py-1.5">
                <SortableItemHandle asChild>
                  <button
                    type="button"
                    className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    aria-label={`Drag to reorder ${member.name}`}
                  >
                    <GripVertical className="size-4" />
                  </button>
                </SortableItemHandle>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{member.name}</p>
                  {member.notes ? (
                    <p className="text-xs italic text-muted-foreground">
                      {member.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  {onEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit ${member.name}`}
                      onClick={() => onEdit(member)}
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
            </SortableItem>
          ))}
        </ul>
      </SortableContent>
    </Sortable>
  );
}

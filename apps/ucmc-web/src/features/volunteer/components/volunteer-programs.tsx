import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CuratedIcon } from "#/components/curated-icon/curated-icon";
import { isCuratedIcon } from "#/components/curated-icon/icon-names";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "#/components/ui/sortable";
import { useReorderOpportunities } from "#/features/volunteer/api/use-opportunity-mutations";
import type { VolunteerOpportunityEntry } from "#/features/volunteer/server/volunteer-fns";

/**
 * The standing volunteer programs — what the club does, as opposed to
 * when it next does it.
 *
 * Read-only viewers get a card grid. `public_volunteer:manage` holders
 * get a draggable list instead, matching how the honorary-members list
 * on /history switches shape: a grid can't carry a drag handle without
 * the drop targets becoming ambiguous in two dimensions.
 */
export function VolunteerPrograms({
  programs,
  canManage = false,
  onEdit,
  onDelete,
}: {
  programs: VolunteerOpportunityEntry[];
  canManage?: boolean;
  onEdit?: (program: VolunteerOpportunityEntry) => void;
  onDelete?: (program: VolunteerOpportunityEntry) => void;
}) {
  if (programs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No volunteer programs listed yet.
      </p>
    );
  }
  if (!canManage) {
    return (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {programs.map((program) => (
          <li key={program.id}>
            <Card className="h-full">
              <CardContent className="flex gap-3 pt-6">
                <ProgramIcon icon={program.icon} />
                <div className="min-w-0 space-y-1">
                  <h3 className="font-semibold leading-tight">
                    {program.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {program.blurb}
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <SortableProgramList
      programs={programs}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

/**
 * `icon` is freeform TEXT in the database, validated against the curated
 * whitelist on write. A row written before a name was retired — or by a
 * direct SQL edit — would otherwise index the component registry to
 * `undefined` and crash the card, so the narrowing is done here and an
 * unknown name simply renders no glyph.
 */
function ProgramIcon({ icon }: { icon: string }) {
  if (!isCuratedIcon(icon)) {
    return null;
  }
  return <CuratedIcon name={icon} className="size-7 shrink-0 text-primary" />;
}

function SortableProgramList({
  programs,
  onEdit,
  onDelete,
}: {
  programs: VolunteerOpportunityEntry[];
  onEdit?: (program: VolunteerOpportunityEntry) => void;
  onDelete?: (program: VolunteerOpportunityEntry) => void;
}) {
  const reorder = useReorderOpportunities();

  // Optimistic local copy so a drop snaps immediately rather than
  // waiting on the round-trip. Keyed on the joined ids rather than the
  // array reference: we resync when the server's membership or ordering
  // actually changes, not on every parent re-render.
  const [items, setItems] = useState<VolunteerOpportunityEntry[]>(programs);
  const idsKey = programs.map((p) => p.id).join(",");
  useEffect(() => {
    setItems(programs);
  }, [idsKey, programs]);

  async function handleReorder(next: VolunteerOpportunityEntry[]) {
    setItems(next);
    try {
      await reorder.mutateAsync({ ids: next.map((p) => p.id) });
    } catch (err) {
      setItems(programs);
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
      getItemValue={(p) => p.id}
    >
      <SortableContent asChild>
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/40">
          {items.map((program) => (
            <SortableItem key={program.id} value={program.id} asChild>
              <li className="flex items-center gap-2 px-3 py-2">
                <SortableItemHandle asChild>
                  <button
                    type="button"
                    className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    aria-label={`Drag to reorder ${program.title}`}
                  >
                    <GripVertical className="size-4" />
                  </button>
                </SortableItemHandle>
                <ProgramIcon icon={program.icon} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{program.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {program.blurb}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {onEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit ${program.title}`}
                      onClick={() => onEdit(program)}
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
                      aria-label={`Delete ${program.title}`}
                      onClick={() => onDelete(program)}
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

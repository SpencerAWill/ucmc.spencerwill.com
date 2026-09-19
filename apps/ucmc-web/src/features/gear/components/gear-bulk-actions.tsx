/**
 * Gear's bulk actions, as material for the `DataToolbar` bulk slot.
 *
 * This is a hook rather than a component because the two halves have to
 * render in different places: the menu items go inside the toolbar's
 * dropdown, while the dialogs they open must be **siblings** of it. A
 * dialog rendered inside `DropdownMenuContent` unmounts the moment the
 * menu closes — which is the same click that opens it. Keeping both in
 * one hook keeps their shared state (the pending retire reason, the
 * pending tag picks) in one place.
 *
 * The toolbar owns the trigger, the selected count and "Clear
 * selection"; everything here is gear-specific.
 */
import { useQuery } from "@tanstack/react-query";
import { Printer, RotateCcw, Tag, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#/components/ui/dropdown-menu";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { gearTagsQueryOptions } from "#/features/gear/api/queries";
import {
  useBulkAddGearTags,
  useBulkDeactivateGear,
  useBulkSetGearCondition,
  useBulkReactivateGear,
} from "#/features/gear/api/use-bulk-gear";
import { GearLabelsDialog } from "#/features/gear/components/gear-labels-dialog";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearStatus,
} from "#/features/gear/server/gear-fns";
import { CONDITION_LABEL } from "#/features/gear/lib/labels";

export interface GearBulkActions {
  /** `DropdownMenu*` items for the toolbar's bulk slot. */
  items: React.ReactNode;
  /** Render as a sibling of the toolbar, not inside the menu. */
  dialogs: React.ReactNode;
  /** True while any bulk mutation is in flight. */
  busy: boolean;
}

export function useGearBulkActions({
  selectedPublicIds,
  statusFilter,
  onClear,
}: {
  selectedPublicIds: string[];
  statusFilter: GearStatus;
  onClear: () => void;
}): GearBulkActions {
  const count = selectedPublicIds.length;
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const { data: tags } = useQuery(gearTagsQueryOptions());

  const retire = useBulkDeactivateGear();
  const unretire = useBulkReactivateGear();
  const setCondition = useBulkSetGearCondition();
  const addTags = useBulkAddGearTags();
  const anyPending =
    retire.isPending ||
    unretire.isPending ||
    setCondition.isPending ||
    addTags.isPending;

  function reportResult(label: string, affected: number, skipped: number) {
    if (affected === 0 && skipped === 0) return;
    const tail = skipped > 0 ? ` (${skipped} skipped)` : "";
    toast.success(
      `${label} ${affected} ${affected === 1 ? "piece" : "pieces"}${tail}`,
    );
    onClear();
  }

  const doRetire = () => {
    retire.mutate(
      {
        publicIds: selectedPublicIds,
        status: "retired" as const,
        reason: retireReason.trim() || null,
      },
      {
        onSuccess: (r) => {
          reportResult("Retired", r.affected, r.skipped);
          setRetireOpen(false);
          setRetireReason("");
        },
        onError: () => toast.error("Couldn't retire."),
      },
    );
  };
  const doUnretire = () => {
    unretire.mutate(
      { publicIds: selectedPublicIds },
      {
        onSuccess: (r) => reportResult("Unretired", r.affected, r.skipped),
        onError: () => toast.error("Couldn't unretire."),
      },
    );
  };
  const doSetCondition = (condition: GearCondition) => {
    setCondition.mutate(
      { publicIds: selectedPublicIds, condition },
      {
        onSuccess: (r) =>
          reportResult(
            `Set ${CONDITION_LABEL[condition].toLowerCase()} on`,
            r.affected,
            r.skipped,
          ),
        onError: () => toast.error("Couldn't update condition."),
      },
    );
  };
  const doAddTags = () => {
    if (pendingTagIds.length === 0) return;
    addTags.mutate(
      { publicIds: selectedPublicIds, tagPublicIds: pendingTagIds },
      {
        onSuccess: (r) => {
          reportResult("Tagged", r.affected, r.skipped);
          setTagsOpen(false);
          setPendingTagIds([]);
        },
        onError: () => toast.error("Couldn't add tags."),
      },
    );
  };

  const items = (
    <>
      <DropdownMenuItem onSelect={() => setLabelsOpen(true)}>
        <Printer className="size-4" />
        Print labels…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTagsOpen(true)}>
        <Tag className="size-4" />
        Add tags…
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Wrench className="size-4" />
          Set condition
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {GEAR_CONDITION_VALUES.map((c) => (
            <DropdownMenuItem key={c} onSelect={() => doSetCondition(c)}>
              {CONDITION_LABEL[c]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {statusFilter === "active" ? (
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => setRetireOpen(true)}
        >
          <Trash2 className="size-4" />
          Retire…
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={doUnretire}>
          <RotateCcw className="size-4" />
          Unretire
        </DropdownMenuItem>
      )}
    </>
  );

  const dialogs = (
    <>
      <AlertDialog
        open={retireOpen}
        onOpenChange={(o) => {
          if (!o) setRetireReason("");
          setRetireOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Retire {count} {count === 1 ? "piece" : "pieces"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Codes on each piece will be cleared so they can be reissued.
              Already-retired pieces in the selection are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-retire-reason">Reason (optional)</Label>
            <Textarea
              id="bulk-retire-reason"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="end of season, replaced with new stock, etc."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retire.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={retire.isPending}
              onClick={(e) => {
                e.preventDefault();
                doRetire();
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GearLabelsDialog
        publicIds={selectedPublicIds}
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
      />

      <Dialog
        open={tagsOpen}
        onOpenChange={(o) => {
          if (!o) setPendingTagIds([]);
          setTagsOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add tags to {count} {count === 1 ? "piece" : "pieces"}
            </DialogTitle>
            <DialogDescription>
              Existing tags on the selected gear are left alone — this only adds
              the picked tags.
            </DialogDescription>
          </DialogHeader>
          <GearTagMultiselect
            allTags={tags ?? []}
            selectedPublicIds={pendingTagIds}
            onChange={setPendingTagIds}
            canCreate
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingTagIds([]);
                setTagsOpen(false);
              }}
              disabled={addTags.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={doAddTags}
              disabled={addTags.isPending || pendingTagIds.length === 0}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { items, dialogs, busy: anyPending };
}

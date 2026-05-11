/**
 * Bulk-actions trigger. Slots into the filter row between the
 * `Filters` popover and the `Sort` Select when selection is
 * non-empty. Renders a single dropdown menu whose items either fire
 * a simple bulk action directly or open a dialog/popover for the
 * actions that need extra input (Retire wants a reason, Add tags
 * wants a multiselect).
 *
 * Returns `null` when no items are selected so the slot collapses
 * naturally — no layout shift, the slot just isn't in the DOM.
 */
import { useQuery } from "@tanstack/react-query";
import {
  CheckSquare,
  ChevronDown,
  Printer,
  RotateCcw,
  Tag,
  Trash2,
  Wrench,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { gearTagsQueryOptions } from "#/features/gear/api/queries";
import {
  useBulkAddGearTags,
  useBulkRetireGear,
  useBulkSetGearCondition,
  useBulkUnretireGear,
} from "#/features/gear/api/use-bulk-gear";
import { GearLabelsDialog } from "#/features/gear/components/gear-labels-dialog";
import { GearTagMultiselect } from "#/features/gear/components/gear-tag-multiselect";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearLifecycle,
} from "#/features/gear/server/gear-fns";

const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

export function GearBulkActionsButton({
  selectedPublicIds,
  lifecycleFilter,
  onClear,
}: {
  selectedPublicIds: string[];
  lifecycleFilter: GearLifecycle;
  onClear: () => void;
}) {
  const count = selectedPublicIds.length;
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const { data: tags } = useQuery(gearTagsQueryOptions());

  const retire = useBulkRetireGear();
  const unretire = useBulkUnretireGear();
  const setCondition = useBulkSetGearCondition();
  const addTags = useBulkAddGearTags();
  const anyPending =
    retire.isPending ||
    unretire.isPending ||
    setCondition.isPending ||
    addTags.isPending;

  if (count === 0) return null;

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
      { publicIds: selectedPublicIds, reason: retireReason.trim() || null },
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="h-9" disabled={anyPending}>
            <CheckSquare className="size-4" />
            <span>{count}</span>
            <span className="hidden sm:inline">selected</span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {count} {count === 1 ? "piece" : "pieces"} selected
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
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
          {lifecycleFilter === "active" ? (
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onClear}>
            Clear selection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
}

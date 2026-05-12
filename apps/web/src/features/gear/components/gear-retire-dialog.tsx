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
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useRetireGear } from "#/features/gear/api/use-retire-gear";
import type { GearSummary } from "#/features/gear/server/gear-fns";

export function GearRetireDialog({
  gear,
  onOpenChange,
}: {
  gear: GearSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const retire = useRetireGear();

  const open = gear !== null;
  const onConfirm = () => {
    if (!gear) return;
    retire.mutate(
      { publicId: gear.publicId, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success(`${gear.code ?? "Gear"} retired`);
          setReason("");
          onOpenChange(false);
        },
        onError: () => {
          toast.error("Couldn't retire the gear. Please try again.");
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Retire {gear?.code ?? gear?.type.name ?? "this gear"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Retiring marks this piece as gone from inventory and frees its code
            (e.g. <span className="font-mono">{gear?.code ?? ""}</span>) so it
            can be reissued to a new piece. You can un-retire later if this was
            a mistake.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="retire-reason">Reason (optional)</Label>
          <Textarea
            id="retire-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="snapped buckle, end of life, etc."
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
              onConfirm();
            }}
          >
            Retire
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

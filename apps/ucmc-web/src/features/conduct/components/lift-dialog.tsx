import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useLiftConductRecord } from "#/features/conduct/api/use-lift-conduct-record";
import { CONDUCT_LIMITS } from "#/features/conduct/server/limits";

/** Lifts a record, with the reason and, for a termination, the appeal outcome. */
export function LiftDialog({
  recordId,
  level,
}: {
  recordId: string;
  level: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [appealOutcome, setAppealOutcome] = useState("");
  const lift = useLiftConductRecord();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Lift</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            lift.mutate(
              {
                recordId,
                reason,
                ...(appealOutcome.trim() === "" ? {} : { appealOutcome }),
              },
              {
                onSuccess: () => {
                  toast.success("Record lifted.");
                  setOpen(false);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Lift this {level}</DialogTitle>
            <DialogDescription>
              The record stays on file with the reason. It no longer counts
              toward the member&rsquo;s standing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="lift-reason">Reason</Label>
            <Textarea
              id="lift-reason"
              value={reason}
              maxLength={CONDUCT_LIMITS.liftReasonMax}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {level === "termination" ? (
            <div className="space-y-1">
              <Label htmlFor="lift-appeal">Appeal outcome (optional)</Label>
              <Textarea
                id="lift-appeal"
                value={appealOutcome}
                maxLength={CONDUCT_LIMITS.liftReasonMax}
                onChange={(e) => setAppealOutcome(e.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              disabled={reason.trim() === "" || lift.isPending}
            >
              Lift record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

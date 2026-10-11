import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useWriteOffLoan } from "#/features/gear/api/use-write-off-loan";
import type { LoanDetail } from "#/features/gear/server/gear-fns";

/**
 * Close a counted loan short. The page only offers this to a
 * `gear:manage` holder on an open counted loan; the action re-checks
 * both, so this dialog's job is to say plainly what the write-off does
 * and to collect the reason the audit row needs.
 */
export function LoanWriteOffDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: LoanDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const writeOff = useWriteOffLoan();
  const [reason, setReason] = useState("");
  const outstanding = loan.quantity - loan.quantityReturned;

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const submit = () => {
    writeOff.mutate(
      { publicId: loan.publicId, reason: reason.trim() },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(
              `Wrote off ${result.quantityLost} and closed the loan.`,
            );
            onOpenChange(false);
          } else if (result.reason === "loan_returned") {
            toast.error("This loan is already closed.");
          } else if (result.reason === "requires_manage") {
            toast.error("Writing off gear needs gear:manage.");
          } else if (result.reason === "not_counted") {
            toast.error("Only counted loans can be written off.");
          } else {
            toast.error("Couldn't find that loan.");
          }
        },
        onError: () => toast.error("Couldn't write off. Please try again."),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off {outstanding} still out?</DialogTitle>
          <DialogDescription>
            {loan.memberFullName} returned {loan.quantityReturned} of{" "}
            {loan.quantity} × {loan.gearName}.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <TriangleAlert />
          <AlertTitle>This closes the loan</AlertTitle>
          <AlertDescription>
            The {outstanding === 1 ? "unit" : "units"} still out{" "}
            {outstanding === 1 ? "is" : "are"} recorded as lost and taken off
            the shelf count, and the loan stops counting toward{" "}
            {loan.memberFullName}&apos;s overdue standing. If{" "}
            {outstanding === 1 ? "it turns" : "they turn"} up later, recount the
            bin. Your reason is recorded in the audit log.
          </AlertDescription>
        </Alert>
        <div className="space-y-1.5">
          <Label htmlFor="write-off-reason">Reason</Label>
          <Textarea
            id="write-off-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dropped at Red River, confirmed with the trip leader…"
            rows={2}
            maxLength={500}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={writeOff.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={writeOff.isPending || reason.trim().length === 0}
          >
            {writeOff.isPending ? "Writing off…" : `Write off ${outstanding}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useExtendLoan } from "#/features/gear/api/use-extend-loan";
import type { LoanDetail } from "#/features/gear/server/gear-fns";
import { toDateInputValue } from "#/lib/date-format";

// The submit path below builds the new due date from runtime-local
// `y/m/d`, so the prefilled value is extracted in the runtime-local zone
// too (mirrors the prior `getFullYear`/`getMonth`/`getDate` helper).
const toIsoDate = (instant: Temporal.Instant): string =>
  toDateInputValue(instant, Temporal.Now.timeZoneId());

export function LoanExtendDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: LoanDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const extend = useExtendLoan();
  const [date, setDate] = useState(() => toIsoDate(loan.dueAt));

  // Reset on each open so reopening doesn't carry a stale partial
  // edit from a prior session.
  useEffect(() => {
    if (open) setDate(toIsoDate(loan.dueAt));
  }, [open, loan.dueAt]);

  const submit = () => {
    const [y, m, d] = date.split("-").map((n) => Number.parseInt(n, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      toast.error("Pick a valid date.");
      return;
    }
    // Parse as local noon so the timestamp doesn't slip a day in
    // negative-UTC zones (matches the inspection-form pattern).
    const newDueAt = new Date(y, m - 1, d, 12).getTime();
    if (newDueAt <= Date.now()) {
      toast.error("New due date must be in the future.");
      return;
    }
    extend.mutate(
      { publicId: loan.publicId, newDueAt },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success("Loan extended");
            onOpenChange(false);
          } else if (result.reason === "loan_returned") {
            toast.error("This loan is already returned.");
          } else if (result.reason === "due_before_now") {
            toast.error("Pick a date in the future.");
          } else {
            toast.error("Couldn't find that loan.");
          }
        },
        onError: () => toast.error("Couldn't extend. Please try again."),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extend loan</DialogTitle>
          <DialogDescription>
            Pick a new due date for {loan.code ?? loan.gearDescription}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="extend-date">New due date</Label>
          <Input
            id="extend-date"
            type="date"
            value={date}
            min={toIsoDate(Temporal.Now.instant().add({ hours: 24 }))}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={extend.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={extend.isPending}>
            {extend.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

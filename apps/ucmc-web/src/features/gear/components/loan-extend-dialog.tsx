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
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useAuth } from "#/features/auth/api/use-auth";
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
  const { hasPermission } = useAuth();
  const [date, setDate] = useState(() => toIsoDate(loan.dueAt));
  const [reason, setReason] = useState("");

  // Reset on each open so reopening doesn't carry a stale partial
  // edit from a prior session.
  useEffect(() => {
    if (open) {
      setDate(toIsoDate(loan.dueAt));
      setReason("");
    }
  }, [open, loan.dueAt]);

  // Extending an already-overdue loan resets the member's cave standing,
  // so the server treats it as a `gear:manage` override. Mirrored here
  // only to explain the refusal before it happens — `hasPermission`
  // rather than a payload-presence check, so role emulation narrows it
  // the way it narrows everything else.
  const isOverdue =
    Temporal.Instant.compare(Temporal.Now.instant(), loan.dueAt) > 0;
  const canOverride = hasPermission("gear:manage");
  const needsReason = isOverdue && canOverride;
  const blocked = isOverdue && !canOverride;

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
      {
        publicId: loan.publicId,
        newDueAt,
        overrideOverdue: isOverdue,
        overrideReason: needsReason ? reason.trim() : null,
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success("Loan extended");
            onOpenChange(false);
          } else if (result.reason === "loan_returned") {
            toast.error("This loan is already returned.");
          } else if (result.reason === "due_before_now") {
            toast.error("Pick a date in the future.");
          } else if (result.reason === "overdue_requires_override") {
            toast.error(
              "This loan is already overdue — extending it needs gear:manage.",
            );
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
            Pick a new due date for {loan.code ?? loan.gearName}.
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>This loan is already overdue</AlertTitle>
            <AlertDescription>
              Extending it would reset the member&apos;s gear-cave standing, so
              it needs <code>gear:manage</code>. Ask an officer who holds it.
            </AlertDescription>
          </Alert>
        ) : null}
        {needsReason ? (
          <Alert>
            <TriangleAlert />
            <AlertTitle>This loan is already overdue</AlertTitle>
            <AlertDescription>
              Extending it clears the member&apos;s overdue standing — if they
              were flagged or blocked, they won&apos;t be any more. The reason
              you give is recorded in the audit log.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="extend-date">New due date</Label>
          <Input
            id="extend-date"
            type="date"
            value={date}
            min={toIsoDate(Temporal.Now.instant().add({ hours: 24 }))}
            onChange={(e) => setDate(e.target.value)}
            disabled={blocked}
          />
        </div>
        {needsReason ? (
          <div className="space-y-1.5">
            <Label htmlFor="extend-reason">Reason</Label>
            <Textarea
              id="extend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Away on a trip, returning Monday…"
              rows={2}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={extend.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              extend.isPending ||
              blocked ||
              (needsReason && reason.trim().length === 0)
            }
          >
            {extend.isPending ? "Saving…" : needsReason ? "Override" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

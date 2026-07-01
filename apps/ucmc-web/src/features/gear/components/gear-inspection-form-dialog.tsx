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
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Textarea } from "#/components/ui/textarea";
import { useRecordGearInspection } from "#/features/gear/api/use-record-gear-inspection";
import type {
  GearInspectionResultValue,
  GearSummary,
} from "#/features/gear/server/gear-fns";

const RESULT_VALUES: readonly GearInspectionResultValue[] = [
  "pass",
  "fail",
  "advisory",
] as const;

const RESULT_LABEL: Record<GearInspectionResultValue, string> = {
  pass: "Pass — safe to use",
  fail: "Fail — pull from service",
  advisory: "Advisory — note an observation",
};

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function GearInspectionFormDialog({
  gear,
  open,
  onOpenChange,
}: {
  gear: GearSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [date, setDate] = useState<string>(todayIsoDate());
  const [result, setResult] = useState<GearInspectionResultValue>("pass");
  const [notes, setNotes] = useState<string>("");
  const record = useRecordGearInspection(gear.publicId);

  // Reset the form whenever the dialog reopens so an officer logging
  // a second inspection in a row doesn't see stale "fail" + notes.
  useEffect(() => {
    if (open) {
      setDate(todayIsoDate());
      setResult("pass");
      setNotes("");
    }
  }, [open]);

  const onSubmit = () => {
    // The date input gives us a calendar day; parse it as local noon so
    // the timestamp doesn't slip a day in negative-UTC-offset zones when
    // round-tripped through `new Date(YYYY-MM-DD)` (which would parse
    // as UTC midnight).
    const [y, m, d] = date.split("-").map((n) => Number.parseInt(n, 10));
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(m) ||
      !Number.isFinite(d) ||
      y < 1970
    ) {
      toast.error("Invalid date.");
      return;
    }
    const inspectedAt = new Date(y, m - 1, d, 12).getTime();
    const trimmedNotes = notes.trim();
    record.mutate(
      {
        gearPublicId: gear.publicId,
        inspectedAt,
        result,
        notes: trimmedNotes.length === 0 ? null : trimmedNotes,
      },
      {
        onSuccess: () => {
          toast.success("Inspection recorded");
          onOpenChange(false);
        },
        onError: () => {
          toast.error("Couldn't record inspection. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log inspection</DialogTitle>
          <DialogDescription>
            Record a safety check on {gear.code ?? gear.description}.
            Inspections are append-only — to correct a mistake, log a new
            inspection.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inspection-date">Inspection date</Label>
            <Input
              id="inspection-date"
              type="date"
              value={date}
              max={todayIsoDate()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Result</Label>
            <RadioGroup
              value={result}
              onValueChange={(v) => setResult(v as GearInspectionResultValue)}
              className="flex flex-col gap-1.5 text-sm"
            >
              {RESULT_VALUES.map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <RadioGroupItem value={v} id={`inspection-result-${v}`} />
                  {RESULT_LABEL[v]}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inspection-notes">Notes (optional)</Label>
            <Textarea
              id="inspection-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Frayed sheath at midpoint, still within tolerance."
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={record.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={record.isPending}>
            {record.isPending ? "Saving…" : "Record inspection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

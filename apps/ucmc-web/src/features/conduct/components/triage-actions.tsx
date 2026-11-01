import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import {
  conductRecordsQueryOptions,
  conductSubjectQueryOptions,
} from "#/features/conduct/api/queries";
import { useAcceptConductReport } from "#/features/conduct/api/use-accept-conduct-report";
import { useDismissConductReport } from "#/features/conduct/api/use-dismiss-conduct-report";
import { RecordForm } from "#/features/conduct/components/record-form";
import {
  CONDUCT_LEVEL_LABELS,
  CONDUCT_LIMITS,
} from "#/features/conduct/server/limits";
import type { ConductReportSummary } from "#/features/conduct/server/report-fns";

type Mode = "start" | "attach" | "dismiss" | null;

function AttachDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ConductReportSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const accept = useAcceptConductReport();
  const [recordId, setRecordId] = useState("");
  const { data = [] } = useQuery({
    ...conductRecordsQueryOptions({}),
    enabled: open,
  });
  // A flagged report only joins a record SCCS already has. The server
  // enforces the same rule; this keeps the list to what will be accepted.
  const options = data.filter(
    (r) =>
      (report.subjectPublicId === null ||
        r.subjectPublicId === report.subjectPublicId) &&
      (!report.possibleScoc || r.scocState === "referred"),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate(
              { reportId: report.id, recordPublicId: recordId },
              {
                onSuccess: () => {
                  toast.success("Report attached.");
                  onOpenChange(false);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Attach to a record</DialogTitle>
            <DialogDescription>
              {report.possibleScoc
                ? "This report may be a Student Code of Conduct violation, so it can only join a record already referred to SCCS."
                : "Choose the record this report belongs to."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`attach-${report.id}`}>Record</Label>
            <NativeSelect
              id={`attach-${report.id}`}
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
            >
              <NativeSelectOption value="">Choose a record</NativeSelectOption>
              {options.map((r) => (
                <NativeSelectOption key={r.publicId} value={r.publicId}>
                  {r.subjectName} — {CONDUCT_LEVEL_LABELS[r.level]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {options.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching record. Start one instead.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={recordId === "" || accept.isPending}
            >
              Attach
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ConductReportSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dismiss = useDismissConductReport();
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            dismiss.mutate(
              { reportId: report.id, reason },
              {
                onSuccess: () => {
                  toast.success("Report dismissed.");
                  onOpenChange(false);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Dismiss this report</DialogTitle>
            <DialogDescription>
              The reason is kept with the report. A dismissed report is deleted
              after a year.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`dismiss-${report.id}`}>Reason</Label>
            <Textarea
              id={`dismiss-${report.id}`}
              value={reason}
              maxLength={CONDUCT_LIMITS.dismissReasonMax}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              variant="destructive"
              disabled={reason.trim() === "" || dismiss.isPending}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Accept (attach to a record, or start one) and Dismiss for a `new`
 * report. Rendered for `conduct:manage` holders only. "Start a record"
 * opens the record form prefilled with the member and the report; the
 * server accepts the report when the record is created.
 */
export function TriageActions({ report }: { report: ConductReportSummary }) {
  const [mode, setMode] = useState<Mode>(null);
  const navigate = useNavigate();
  // The list carries no internal ids, so the member to prefill is looked
  // up by public id through the manager-only fn.
  const named = report.subjectPublicId !== null;
  const lookup = useQuery({
    ...conductSubjectQueryOptions(report.subjectPublicId ?? ""),
    enabled: mode === "start" && named,
  });
  const lookupSettled = !named || !lookup.isPending;
  const subject = lookup.data ?? null;
  const memberGone = named && lookupSettled && subject === null;
  const close = (next: boolean) => {
    if (!next) {
      setMode(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" aria-haspopup="dialog" onClick={() => setMode("start")}>
        Start a record
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setMode("attach")}
      >
        Attach to a record
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setMode("dismiss")}
      >
        Dismiss
      </Button>
      {mode === "start" ? (
        <Sheet open onOpenChange={close}>
          <SheetContent size="xl" className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Start a record from this report</SheetTitle>
              <SheetDescription>
                {memberGone
                  ? "The member this report names is no longer available."
                  : named
                    ? "Creating the record accepts the report."
                    : "This report does not name a member. Choose who the record is about."}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              {!lookupSettled ? (
                <p className="text-sm text-muted-foreground">Loading member…</p>
              ) : memberGone ? null : (
                <RecordForm
                  initialSubject={subject}
                  initialPossibleScoc={report.possibleScoc}
                  reportIds={[report.id]}
                  onCreated={(publicId) => {
                    setMode(null);
                    void navigate({
                      to: "/conduct/$publicId",
                      params: { publicId },
                    });
                  }}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      <AttachDialog
        report={report}
        open={mode === "attach"}
        onOpenChange={close}
      />
      <DismissDialog
        report={report}
        open={mode === "dismiss"}
        onOpenChange={close}
      />
    </div>
  );
}

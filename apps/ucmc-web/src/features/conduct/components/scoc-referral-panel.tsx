import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import { useRecordSccsOutcome } from "#/features/conduct/api/use-record-sccs-outcome";
import { useReferConductRecord } from "#/features/conduct/api/use-refer-conduct-record";
import {
  CONDUCT_LIMITS,
  SCCS_PHONE_DISPLAY,
  SCCS_PHONE_HREF,
} from "#/features/conduct/server/limits";
import {
  SCOC_STATE_LABELS,
  formatPlainDate,
} from "#/features/conduct/lib/format";
import type { ConductRecordDetail } from "#/features/conduct/server/record-fns";

/**
 * Who to call about a possible Student Code of Conduct violation, and
 * what referring it does not do. Shown wherever a record is flagged.
 */
export function SccsContactInfo() {
  return (
    <Alert>
      <AlertTitle>Possible SCOC violation</AlertTitle>
      <AlertDescription>
        <p>
          Refer this to Student Conduct and Community Standards (SCCS) at{" "}
          <a href={SCCS_PHONE_HREF} className="underline underline-offset-4">
            {SCCS_PHONE_DISPLAY}
          </a>
          . While it is referred, the club cannot issue a warning, suspension or
          termination for it.
        </p>
        <p>
          Referring a matter to SCCS does not discharge the club&rsquo;s Clery
          Act reporting duties.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The SCCS referral state of a record: refer it, record the outcome, or
 * show what was decided. Manager-only controls are the caller's gate.
 */
export function ScocReferralPanel({
  record,
  canManage,
}: {
  record: ConductRecordDetail;
  canManage: boolean;
}) {
  const refer = useReferConductRecord();
  const outcome = useRecordSccsOutcome();
  const [referredOn, setReferredOn] = useState("");
  const [result, setResult] = useState<"returned" | "sccs_sanctioned">(
    "returned",
  );
  const [note, setNote] = useState("");

  if (record.liftedAt) {
    return null;
  }

  if (record.scocState === "none") {
    if (!canManage) {
      return null;
    }
    return (
      <section className="space-y-3" aria-label="SCCS referral">
        <h2 className="text-lg font-semibold">SCCS referral</h2>
        <SccsContactInfo />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            refer.mutate(
              { recordId: record.publicId, referredOn },
              {
                onSuccess: () => toast.success("Marked as referred to SCCS."),
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="referred-on">Referred on</Label>
            <Input
              id="referred-on"
              type="date"
              value={referredOn}
              onChange={(e) => setReferredOn(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={referredOn === "" || refer.isPending}
          >
            Mark as referred
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label="SCCS referral">
      <h2 className="text-lg font-semibold">SCCS referral</h2>
      <p className="text-sm">
        {SCOC_STATE_LABELS[record.scocState]}
        {record.referredOn
          ? `. Referred on ${formatPlainDate(record.referredOn)}${record.referredByName ? ` by ${record.referredByName}` : ""}.`
          : "."}
      </p>
      {record.sccsOutcomeNote ? (
        <p className="text-sm whitespace-pre-wrap">{record.sccsOutcomeNote}</p>
      ) : null}
      {record.scocState === "referred" ? (
        <>
          <SccsContactInfo />
          {canManage ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                outcome.mutate(
                  { recordId: record.publicId, outcome: result, note },
                  {
                    onSuccess: () => toast.success("SCCS outcome recorded."),
                    onError: (err) => toast.error(err.message),
                  },
                );
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="sccs-outcome">Outcome</Label>
                <NativeSelect
                  id="sccs-outcome"
                  value={result}
                  onChange={(e) =>
                    setResult(e.target.value as "returned" | "sccs_sanctioned")
                  }
                >
                  <NativeSelectOption value="returned">
                    Returned to the club
                  </NativeSelectOption>
                  <NativeSelectOption value="sccs_sanctioned">
                    Sanctioned by SCCS
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sccs-note">What SCCS decided</Label>
                <Textarea
                  id="sccs-note"
                  value={note}
                  maxLength={CONDUCT_LIMITS.notesMax}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={note.trim() === "" || outcome.isPending}
              >
                Record outcome
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

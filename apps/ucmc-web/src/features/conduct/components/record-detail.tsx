import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useUpdateConductRecord } from "#/features/conduct/api/use-update-conduct-record";
import { LiftDialog } from "#/features/conduct/components/lift-dialog";
import { ScocReferralPanel } from "#/features/conduct/components/scoc-referral-panel";
import {
  formatClubDate,
  formatDateRange,
  formatPlainDate,
} from "#/features/conduct/lib/format";
import {
  CONDUCT_LEVEL_LABELS,
  CONDUCT_LIMITS,
} from "#/features/conduct/server/limits";
import type { ConductRecordDetail } from "#/features/conduct/server/record-fns";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function InternalNotes({
  record,
  canManage,
}: {
  record: ConductRecordDetail;
  canManage: boolean;
}) {
  const update = useUpdateConductRecord();
  const [notes, setNotes] = useState(record.internalNotes ?? "");
  const [editing, setEditing] = useState(false);

  if (!canManage || record.liftedAt) {
    return (
      <Field label="Internal notes">{record.internalNotes ?? "None"}</Field>
    );
  }
  if (!editing) {
    return (
      <div className="space-y-2">
        <Field label="Internal notes">{record.internalNotes ?? "None"}</Field>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit notes
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          { recordId: record.publicId, internalNotes: notes },
          {
            onSuccess: () => {
              toast.success("Notes saved.");
              setEditing(false);
            },
            onError: (err) => toast.error(err.message),
          },
        );
      }}
    >
      <Label htmlFor="internal-notes">Internal notes</Label>
      <Textarea
        id="internal-notes"
        value={notes}
        maxLength={CONDUCT_LIMITS.notesMax}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          Save notes
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One conduct record: its facts, SCCS state, lifecycle actions and audit trail. */
export function RecordDetail({
  record,
  canManage,
}: {
  record: ConductRecordDetail;
  canManage: boolean;
}) {
  const range = formatDateRange(record.startsOn, record.endsOn);
  const hasVote = record.votesFor !== null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {record.subjectPublicId ? (
              <Link
                to="/members/$publicId"
                params={{ publicId: record.subjectPublicId }}
                className="underline-offset-4 hover:underline"
              >
                {record.subjectName}
              </Link>
            ) : (
              <span>{record.subjectName}</span>
            )}
          </h1>
          <Badge variant="secondary">
            {CONDUCT_LEVEL_LABELS[record.level]}
          </Badge>
          {record.liftedAt ? <Badge variant="outline">Lifted</Badge> : null}
        </div>
        {range ? (
          <p className="text-sm text-muted-foreground">{range}</p>
        ) : null}
      </header>

      {record.liftedAt ? (
        <section className="space-y-2" aria-label="Lifted">
          <h2 className="text-lg font-semibold">Lifted</h2>
          <dl className="space-y-3">
            <Field label="Lifted on">
              {formatClubDate(record.liftedAt)}
              {record.liftedByName ? ` by ${record.liftedByName}` : ""}
            </Field>
            <Field label="Reason">{record.liftReason}</Field>
            {record.appealOutcome ? (
              <Field label="Appeal outcome">{record.appealOutcome}</Field>
            ) : null}
          </dl>
        </section>
      ) : null}

      <dl className="space-y-3">
        {record.memberStatement ? (
          <Field label="Member statement">{record.memberStatement}</Field>
        ) : null}
        <InternalNotes record={record} canManage={canManage} />
        {hasVote ? (
          <Field label="Vote">
            {`${record.votesFor} for, ${record.votesAgainst} against, ${record.votesAbstain} abstaining, of ${record.committeeSize}${record.voteHeldOn ? `. Held ${formatPlainDate(record.voteHeldOn)}` : ""}`}
          </Field>
        ) : null}
        {record.priorWarningPublicId ? (
          <Field label="Prior warning">
            <Link
              to="/conduct/$publicId"
              params={{ publicId: record.priorWarningPublicId }}
              className="underline underline-offset-4"
            >
              View the warning
            </Link>
          </Field>
        ) : null}
        {record.warningSkipped ? (
          <Field label="Prior warning">
            None. The warning step was skipped.
          </Field>
        ) : null}
        {record.level !== "note" ? (
          <Field label="Notice">
            {record.noticeSentAt
              ? `Sent ${formatClubDate(record.noticeSentAt)}`
              : "Notice not sent"}
          </Field>
        ) : null}
        <Field label="Created">
          {formatClubDate(record.createdAt)}
          {record.createdByName ? ` by ${record.createdByName}` : ""}
        </Field>
      </dl>

      <ScocReferralPanel record={record} canManage={canManage} />

      {canManage && !record.liftedAt ? (
        <section className="space-y-2" aria-label="Actions">
          <h2 className="text-lg font-semibold">Actions</h2>
          {record.level === "note" ? (
            <p className="text-sm text-muted-foreground">
              Lifting a note closes it.
            </p>
          ) : null}
          <LiftDialog
            recordId={record.publicId}
            level={CONDUCT_LEVEL_LABELS[record.level].toLowerCase()}
          />
        </section>
      ) : null}

      <section className="space-y-2" aria-label="Linked reports">
        <h2 className="text-lg font-semibold">Linked reports</h2>
        {record.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked reports.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {record.reports.map((report) => (
              <li key={report.id}>
                {formatPlainDate(report.occurredOn)} ({report.status})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label="History">
        <h2 className="text-lg font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {record.history.map((row) => (
            <li key={row.id}>
              {formatClubDate(row.createdAt)}: {row.action}
              {row.actorName ? ` by ${row.actorName}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

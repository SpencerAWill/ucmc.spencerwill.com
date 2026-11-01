import { Link } from "@tanstack/react-router";
import { MailCheck, MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { cn } from "#/lib/utils";
import { useUpdateConductRecord } from "#/features/conduct/api/use-update-conduct-record";
import {
  ConfidentialEyebrow,
  ExecOnlyTag,
} from "#/features/conduct/components/conduct-chrome";
import { CorrectRecordSheet } from "#/features/conduct/components/correct-record-sheet";
import { LiftDialog } from "#/features/conduct/components/lift-dialog";
import { Panel } from "#/features/conduct/components/panel";
import { ScocReferralPanel } from "#/features/conduct/components/scoc-referral-panel";
import { VoteBar } from "#/features/conduct/components/vote-bar";
import {
  LEVEL_FILL,
  SeverityMark,
} from "#/features/conduct/components/severity-mark";
import {
  formatClubDate,
  formatDateRange,
  formatPlainDate,
} from "#/features/conduct/lib/format";
import { historyLabel } from "#/features/conduct/lib/history";
import {
  CONDUCT_LEVEL_LABELS,
  CONDUCT_LIMITS,
} from "#/features/conduct/server/limits";
import type { ConductRecordDetail } from "#/features/conduct/server/record-fns";

const REPORT_STATUS_LABELS = {
  new: "New",
  accepted: "Accepted",
  dismissed: "Dismissed",
} as const;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function RecordLink({ publicId, label }: { publicId: string; label: string }) {
  return (
    <Link
      to="/conduct/$publicId"
      params={{ publicId }}
      className="underline underline-offset-4"
    >
      {label}
    </Link>
  );
}

/**
 * A correction replaces a sent notice or a sanction in force, once, and
 * not while SCCS holds the matter. The server applies the same rule.
 */
function canCorrect(record: ConductRecordDetail): boolean {
  return (
    record.level !== "note" &&
    record.supersededByPublicId === null &&
    record.scocState !== "referred" &&
    (record.noticeSentAt !== null || record.liftedAt === null)
  );
}

function StatusBadges({ record }: { record: ConductRecordDetail }) {
  if (record.liftedAt) {
    return <Badge variant="outline">Lifted</Badge>;
  }
  if (record.scocState === "referred") {
    return <Badge variant="warning">Referred to SCCS</Badge>;
  }
  return <Badge variant="secondary">Open</Badge>;
}

function CaseHeader({
  record,
  canManage,
}: {
  record: ConductRecordDetail;
  canManage: boolean;
}) {
  const range = formatDateRange(record.startsOn, record.endsOn);
  const correctable = canManage && canCorrect(record);
  const liftable = canManage && !record.liftedAt;

  return (
    <header className="overflow-hidden rounded-lg border bg-card">
      <div
        aria-hidden="true"
        className={cn("h-1.5", LEVEL_FILL[record.level])}
      />
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <SeverityMark level={record.level} size="lg" />
            <StatusBadges record={record} />
          </div>
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
          <p className="text-sm text-muted-foreground">
            {range ? `${range} · ` : ""}
            Opened {formatClubDate(record.createdAt)}
            {record.createdByName ? ` by ${record.createdByName}` : ""}
          </p>
        </div>
        {liftable || correctable ? (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {liftable ? (
                <LiftDialog
                  recordId={record.publicId}
                  level={CONDUCT_LEVEL_LABELS[record.level].toLowerCase()}
                />
              ) : null}
              {correctable ? (
                <CorrectRecordSheet publicId={record.publicId} />
              ) : null}
            </div>
            {liftable && record.level === "note" ? (
              <p className="text-xs text-muted-foreground">
                Lifting a note closes it.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function LiftedPanel({ record }: { record: ConductRecordDetail }) {
  if (!record.liftedAt) {
    return null;
  }
  return (
    <Panel title="Lifted" className="border-dashed">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Lifted on">
          {formatClubDate(record.liftedAt)}
          {record.liftedByName ? ` by ${record.liftedByName}` : ""}
        </Field>
        <Field label="Reason">{record.liftReason}</Field>
        {record.appealOutcome ? (
          <Field label="Appeal outcome">{record.appealOutcome}</Field>
        ) : null}
      </dl>
    </Panel>
  );
}

/** What the member was sent, as they read it, and whether it went out. */
function StatementPanel({ record }: { record: ConductRecordDetail }) {
  if (record.level === "note" || !record.memberStatement) {
    return null;
  }
  return (
    <Panel title="What the member was told">
      <div className="rounded-md border bg-background p-4 leading-relaxed whitespace-pre-wrap">
        {record.memberStatement}
      </div>
      {record.noticeSentAt ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <MailCheck aria-hidden="true" className="size-4" />
          Emailed {formatClubDate(record.noticeSentAt)}
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <MailWarning
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div>
            <p className="font-medium text-destructive">Notice not sent</p>
            <p className="text-muted-foreground">
              The member had no verified email address, or the send failed. Tell
              them another way.
            </p>
          </div>
        </div>
      )}
    </Panel>
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
  const editable = canManage && !record.liftedAt;

  return (
    <Panel
      title={record.level === "note" ? "Notes" : "Internal notes"}
      aside={<ExecOnlyTag />}
    >
      {editing ? (
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
          <Label htmlFor="internal-notes" className="sr-only">
            Internal notes
          </Label>
          <Textarea
            id="internal-notes"
            className="min-h-32"
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
      ) : (
        <>
          <p
            className={cn(
              "whitespace-pre-wrap",
              !record.internalNotes && "text-muted-foreground",
            )}
          >
            {record.internalNotes ?? "None"}
          </p>
          {editable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              Edit notes
            </Button>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** The §9.1 vote: the bar, then the numbers it pictures. */
function VotePanel({ record }: { record: ConductRecordDetail }) {
  if (record.votesFor === null || record.committeeSize === null) {
    return null;
  }
  const size = record.committeeSize;
  const needed = Math.ceil((size * 2) / 3);
  return (
    <Panel title="Committee vote">
      <VoteBar
        votesFor={record.votesFor}
        votesAgainst={record.votesAgainst ?? 0}
        votesAbstain={record.votesAbstain ?? 0}
        committeeSize={size}
      />
      <p>
        {`${record.votesFor} for, ${record.votesAgainst} against, ${record.votesAbstain} abstaining, of ${size}. Two thirds is ${needed}.`}
      </p>
      {record.voteHeldOn ? (
        <p className="text-muted-foreground">
          Held {formatPlainDate(record.voteHeldOn)}
        </p>
      ) : null}
    </Panel>
  );
}

function LinkedReports({ record }: { record: ConductRecordDetail }) {
  return (
    <Panel title="Linked reports">
      {record.reports.length === 0 ? (
        <p className="text-muted-foreground">No linked reports.</p>
      ) : (
        <ul className="divide-y">
          {record.reports.map((report) => (
            <li key={report.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {formatPlainDate(report.occurredOn)}
                </span>
                <Badge variant="outline">
                  {REPORT_STATUS_LABELS[report.status]}
                </Badge>
              </p>
              <p className="line-clamp-2 text-muted-foreground">
                {report.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CaseFacts({ record }: { record: ConductRecordDetail }) {
  const range = formatDateRange(record.startsOn, record.endsOn);
  return (
    <Panel title="Case facts">
      <dl className="space-y-3">
        <Field label="Level">{CONDUCT_LEVEL_LABELS[record.level]}</Field>
        {range ? <Field label="Dates">{range}</Field> : null}
        {record.priorWarningPublicId ? (
          <Field label="Prior warning">
            <RecordLink
              publicId={record.priorWarningPublicId}
              label="View the warning"
            />
          </Field>
        ) : null}
        {record.warningSkipped ? (
          <Field label="Prior warning">
            None. The warning step was skipped.
          </Field>
        ) : null}
        {record.supersedesPublicId ? (
          <Field label="Supersedes">
            <RecordLink
              publicId={record.supersedesPublicId}
              label="View the corrected record"
            />
          </Field>
        ) : null}
        {record.supersededByPublicId ? (
          <Field label="Superseded by">
            <RecordLink
              publicId={record.supersededByPublicId}
              label="View the correction"
            />
          </Field>
        ) : null}
        <Field label="Opened">
          {formatClubDate(record.createdAt)}
          {record.createdByName ? ` by ${record.createdByName}` : ""}
        </Field>
      </dl>
    </Panel>
  );
}

function Timeline({ record }: { record: ConductRecordDetail }) {
  return (
    <Panel title="Timeline">
      {record.history.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l pl-4">
          {record.history.map((row) => (
            <li key={row.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary"
              />
              <p className="font-medium">
                {historyLabel(row.action, row.metadataJson)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatClubDate(row.createdAt)}
                {row.actorName ? ` · ${row.actorName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/**
 * One conduct record as a case file: a header with the level, status and
 * actions, then what the member was told and what exec knows on the
 * left, and the facts, SCCS state and timeline on the right. One column
 * below `lg`, in reading order.
 */
export function RecordDetail({
  record,
  canManage,
}: {
  record: ConductRecordDetail;
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/conduct">Conduct</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/conduct/records">Records</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Record</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <ConfidentialEyebrow />
      </div>

      <CaseHeader record={record} canManage={canManage} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <LiftedPanel record={record} />
          <StatementPanel record={record} />
          <InternalNotes record={record} canManage={canManage} />
          <VotePanel record={record} />
          <LinkedReports record={record} />
        </div>
        <aside aria-label="Case summary" className="min-w-0 space-y-6">
          <CaseFacts record={record} />
          <ScocReferralPanel record={record} canManage={canManage} />
          <Timeline record={record} />
        </aside>
      </div>
    </div>
  );
}

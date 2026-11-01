import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
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
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { Textarea } from "#/components/ui/textarea";
import {
  conductNoticePreviewQueryOptions,
  conductRecordsQueryOptions,
  conductSubjectsQueryOptions,
} from "#/features/conduct/api/queries";
import { useCreateConductRecord } from "#/features/conduct/api/use-create-conduct-record";
import { SccsContactInfo } from "#/features/conduct/components/scoc-referral-panel";
import {
  CONDUCT_LEVEL_LABELS,
  CONDUCT_LIMITS,
  STATEMENT_TEMPLATE,
  createRecordSchema,
} from "#/features/conduct/server/limits";
import type { CreateRecordInput } from "#/features/conduct/server/limits";
import type {
  ConductSubjectOption,
  CorrectionDraft,
} from "#/features/conduct/server/record-fns";

type Level = keyof typeof CONDUCT_LEVEL_LABELS;

const LEVELS = Object.keys(CONDUCT_LEVEL_LABELS) as Level[];
/** Levels a possible SCOC violation may not be issued at (it waits on SCCS). */
const SCOC_BLOCKED: readonly Level[] = ["warning", "suspension", "termination"];
const UNRESOLVED_PLACEHOLDER = /\[[^\]]+\]/;

function SubjectPicker({
  selected,
  onSelect,
}: {
  selected: ConductSubjectOption | null;
  onSelect: (subject: ConductSubjectOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input).trim();
  const { data, isFetching } = useQuery({
    ...conductSubjectsQueryOptions(deferred),
    enabled: open && deferred.length > 0,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          id="conduct-subject"
          aria-expanded={open}
          aria-label={selected ? `Member: ${selected.fullName}` : "Member"}
          className="w-full justify-between"
        >
          {selected ? (
            selected.fullName
          ) : (
            <span className="text-muted-foreground">Search by name…</span>
          )}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search by name…"
          />
          <CommandList>
            {isFetching ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : null}
            <CommandEmpty>
              {deferred.length === 0
                ? "Start typing a name."
                : "No approved members match."}
            </CommandEmpty>
            {(data ?? []).map((member) => (
              <CommandItem
                key={member.userId}
                value={member.userId}
                onSelect={() => {
                  onSelect(member);
                  setOpen(false);
                  setInput("");
                }}
              >
                {member.fullName}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Opens a conduct record. The fields follow the level: a note is
 * internal only; the rest carry a member statement; a termination adds
 * the committee vote and its prior-warning step. Validity is the same
 * `createRecordSchema` the server runs, so the form cannot disagree
 * with it.
 *
 * With `correction` it corrects a sent or active record: prefilled from
 * it, about the same member (no picker), never a note, and created with
 * `supersedesPublicId`, which lifts the old record in the same write.
 */
export function RecordForm({
  initialSubject = null,
  initialPossibleScoc = false,
  reportIds = [],
  correction,
  onCreated,
}: {
  initialSubject?: ConductSubjectOption | null;
  initialPossibleScoc?: boolean;
  reportIds?: string[];
  correction?: { supersedesPublicId: string; draft: CorrectionDraft };
  onCreated?: (publicId: string) => void;
}) {
  const draft = correction?.draft;
  const create = useCreateConductRecord();
  const [subject, setSubject] = useState(draft?.subject ?? initialSubject);
  const [level, setLevel] = useState<Level>(draft?.level ?? "note");
  const [possibleScoc, setPossibleScoc] = useState(initialPossibleScoc);
  const [internalNotes, setInternalNotes] = useState("");
  // null until the officer types, so the template follows the level.
  const [editedStatement, setEditedStatement] = useState<string | null>(
    draft?.memberStatement ?? null,
  );
  const [startsOn, setStartsOn] = useState(draft?.startsOn?.toString() ?? "");
  const [endsOn, setEndsOn] = useState(draft?.endsOn?.toString() ?? "");
  const vote = draft?.vote;
  const [heldOn, setHeldOn] = useState(vote?.heldOn.toString() ?? "");
  const [votesFor, setVotesFor] = useState(vote ? String(vote.for) : "");
  const [votesAgainst, setVotesAgainst] = useState(
    vote ? String(vote.against) : "",
  );
  const [votesAbstain, setVotesAbstain] = useState(
    vote ? String(vote.abstain) : "",
  );
  const [committeeSize, setCommitteeSize] = useState(
    vote ? String(vote.committeeSize) : "",
  );
  const [priorWarningId, setPriorWarningId] = useState(
    draft?.priorWarningPublicId ?? "",
  );
  const [noPriorWarning, setNoPriorWarning] = useState(
    draft?.warningSkipped ?? false,
  );
  const [confirming, setConfirming] = useState(false);

  const statement = editedStatement ?? STATEMENT_TEMPLATE;
  const hasStatement = level !== "note";
  const availableLevels = LEVELS.filter(
    (l) =>
      !(possibleScoc && SCOC_BLOCKED.includes(l)) &&
      !(correction && l === "note"),
  );
  const supersedes = correction
    ? { supersedesPublicId: correction.supersedesPublicId }
    : {};

  const warnings = useQuery({
    ...conductRecordsQueryOptions({ level: "warning" }),
    enabled: level === "termination" && subject !== null,
  });
  const subjectWarnings = (warnings.data ?? []).filter(
    (w) =>
      w.subjectPublicId !== null && w.subjectPublicId === subject?.publicId,
  );

  const optionalDate = (value: string) =>
    value === "" ? {} : { startsOn: value };
  const input = {
    level,
    subjectUserId: subject?.userId ?? "",
    internalNotes,
    possibleScoc,
    reportIds,
    ...supersedes,
    ...(hasStatement ? { memberStatement: statement } : {}),
    ...optionalDate(startsOn),
    ...(level === "warning" || level === "suspension"
      ? endsOn === ""
        ? {}
        : { endsOn }
      : {}),
    ...(level === "termination"
      ? {
          vote: {
            heldOn,
            for: Number(votesFor),
            against: Number(votesAgainst),
            abstain: Number(votesAbstain),
            committeeSize: Number(committeeSize),
          },
          ...(noPriorWarning
            ? { warningSkipped: true }
            : priorWarningId === ""
              ? {}
              : { priorWarningId }),
        }
      : {}),
  } as CreateRecordInput;

  const parsed = createRecordSchema.safeParse(input);
  // Explains the disabled submit: a suspension's dates are required.
  const datesNeeded =
    level === "suspension" && (startsOn === "" || endsOn === "");
  const unresolved = hasStatement && UNRESOLVED_PLACEHOLDER.test(statement);
  const valid = subject !== null && parsed.success && !unresolved;
  const voteIssue =
    level === "termination" && votesFor !== "" && committeeSize !== ""
      ? parsed.error?.issues.find((i) => i.path[0] === "vote")?.message
      : undefined;
  const needed =
    Number(committeeSize) > 0
      ? Math.ceil((Number(committeeSize) * 2) / 3)
      : null;

  // Fetched only while the confirm step is open, for the levels that email.
  const previewInput = {
    level: level === "note" ? "warning" : level,
    memberStatement: statement,
    ...(startsOn === "" ? {} : { startsOn }),
    ...(level !== "termination" && endsOn !== "" ? { endsOn } : {}),
    ...supersedes,
  };
  const preview = useQuery({
    ...conductNoticePreviewQueryOptions(previewInput),
    enabled: confirming && hasStatement,
  });

  const submit = () => {
    create.mutate(input, {
      onSuccess: ({ publicId }) => {
        toast.success(correction ? "Correction issued." : "Record created.");
        setConfirming(false);
        onCreated?.(publicId);
      },
      onError: (err) => {
        setConfirming(false);
        toast.error(err.message);
      },
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) {
          return;
        }
        if (hasStatement) {
          setConfirming(true);
        } else {
          submit();
        }
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="conduct-subject">Member</Label>
        {correction ? (
          <p id="conduct-subject" className="text-sm">
            {subject?.fullName}
          </p>
        ) : (
          <SubjectPicker selected={subject} onSelect={setSubject} />
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="conduct-level">Level</Label>
        <NativeSelect
          id="conduct-level"
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
        >
          {availableLevels.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {CONDUCT_LEVEL_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {/* A correction is never a note, and a possible SCOC violation
          waits on SCCS at note level, so a correction cannot be one. */}
      {correction ? null : (
        <div className="flex items-center gap-2">
          <Checkbox
            id="conduct-scoc"
            checked={possibleScoc}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setPossibleScoc(next);
              if (next && SCOC_BLOCKED.includes(level)) {
                setLevel("note");
              }
            }}
          />
          <Label htmlFor="conduct-scoc">Possible SCOC violation</Label>
        </div>
      )}
      {possibleScoc ? <SccsContactInfo /> : null}

      {hasStatement ? (
        <div className="space-y-1">
          <Label htmlFor="conduct-statement">Member statement</Label>
          <Textarea
            id="conduct-statement"
            className="min-h-48"
            value={statement}
            maxLength={CONDUCT_LIMITS.statementMax}
            onChange={(e) => setEditedStatement(e.target.value)}
          />
          {unresolved ? (
            <p role="alert" className="text-sm text-destructive">
              Replace every [bracketed] part of the statement before sending.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The member receives this text.
            </p>
          )}
        </div>
      ) : null}

      {level !== "termination" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {level !== "note" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="conduct-starts">Starts on</Label>
                <Input
                  id="conduct-starts"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="conduct-ends">Ends on</Label>
                <Input
                  id="conduct-ends"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
            </>
          ) : null}
          {datesNeeded ? (
            <p
              id="conduct-dates-hint"
              className="text-sm text-muted-foreground sm:col-span-2"
            >
              A suspension needs a start date and an end date.
            </p>
          ) : null}
        </div>
      ) : (
        <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Committee vote</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="vote-held">Vote held on</Label>
              <Input
                id="vote-held"
                type="date"
                value={heldOn}
                onChange={(e) => setHeldOn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vote-size">Committee size</Label>
              <Input
                id="vote-size"
                type="number"
                min={1}
                value={committeeSize}
                onChange={(e) => setCommitteeSize(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vote-for">Votes for</Label>
              <Input
                id="vote-for"
                type="number"
                min={0}
                value={votesFor}
                onChange={(e) => setVotesFor(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vote-against">Votes against</Label>
              <Input
                id="vote-against"
                type="number"
                min={0}
                value={votesAgainst}
                onChange={(e) => setVotesAgainst(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vote-abstain">Abstentions</Label>
              <Input
                id="vote-abstain"
                type="number"
                min={0}
                value={votesAbstain}
                onChange={(e) => setVotesAbstain(e.target.value)}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {needed === null
              ? "A termination needs two thirds of the whole committee."
              : `A termination needs two thirds of the whole committee: at least ${needed} of ${committeeSize} votes for.`}
          </p>
          {voteIssue ? (
            <p role="alert" className="text-sm text-destructive">
              {voteIssue}
            </p>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="prior-warning">Prior warning</Label>
            <NativeSelect
              id="prior-warning"
              value={priorWarningId}
              disabled={noPriorWarning || subject === null}
              onChange={(e) => setPriorWarningId(e.target.value)}
            >
              <NativeSelectOption value="">
                {subject === null ? "Pick a member first" : "Choose a warning"}
              </NativeSelectOption>
              {subjectWarnings.map((w) => (
                <NativeSelectOption key={w.publicId} value={w.publicId}>
                  {`Warning from ${w.startsOn?.toString() ?? "an unknown date"}${w.liftedAt ? " (lifted)" : ""}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="no-prior-warning"
              checked={noPriorWarning}
              onCheckedChange={(checked) => {
                setNoPriorWarning(checked === true);
                if (checked === true) {
                  setPriorWarningId("");
                }
              }}
            />
            <Label htmlFor="no-prior-warning">No prior warning</Label>
          </div>
          {noPriorWarning ? (
            <p className="text-sm text-muted-foreground">
              Terminating without a prior warning skips a step the constitution
              expects (§9.1). This is recorded on the record.
            </p>
          ) : null}
        </fieldset>
      )}

      <div className="space-y-1">
        <Label htmlFor="conduct-notes">
          {level === "note" ? "Notes" : "Internal notes"}
        </Label>
        <Textarea
          id="conduct-notes"
          value={internalNotes}
          maxLength={CONDUCT_LIMITS.notesMax}
          onChange={(e) => setInternalNotes(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Only conduct officers see these.
        </p>
      </div>

      <Button type="submit" disabled={!valid || create.isPending}>
        {hasStatement ? "Review and send" : "Save note"}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Issue this {CONDUCT_LEVEL_LABELS[level].toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  The member is emailed exactly this, and it cannot be edited
                  afterwards.
                </p>
                {preview.isPending ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    Loading the email preview…
                  </p>
                ) : preview.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    Could not load the email preview. Go back and try again.
                  </p>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-2 text-sm text-foreground">
                    <p className="font-medium">
                      Subject: {preview.data.subject}
                    </p>
                    <p className="whitespace-pre-wrap">{preview.data.text}</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={create.isPending || !preview.isSuccess}
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              Issue {CONDUCT_LEVEL_LABELS[level].toLowerCase()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

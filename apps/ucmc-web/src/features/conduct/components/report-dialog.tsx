import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { Textarea } from "#/components/ui/textarea";
import { reportSubjectsQueryOptions } from "#/features/conduct/api/queries";
import { useSubmitConductReport } from "#/features/conduct/api/use-submit-conduct-report";
import {
  CONDUCT_LIMITS,
  submitReportSchema,
} from "#/features/conduct/server/limits";
import type { SubmitReportInput } from "#/features/conduct/server/limits";
import type { ReportSubjectOption } from "#/features/conduct/server/report-fns";

/** UC's report hub (Title IX and discrimination reports). Checked 2026-10-31. */
export const UC_TITLE_IX_URL =
  "https://www.uc.edu/about/ethics-compliance-community/reports-resolutions.html";
/** UC's anonymous reporting line (EthicsPoint). Checked 2026-10-31. */
export const UC_ANONYMOUS_REPORT_URL =
  "https://secure.ethicspoint.com/domain/media/en/gui/22314/index.html";

function MemberPicker({
  selected,
  onSelect,
}: {
  selected: ReportSubjectOption | null;
  onSelect: (member: ReportSubjectOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input).trim();
  const { data, isFetching } = useQuery({
    ...reportSubjectsQueryOptions(deferred),
    enabled: open && deferred.length > 0,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          id="report-member"
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
                key={member.publicId}
                value={member.publicId}
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

function ReportForm({ onSubmitted }: { onSubmitted: () => void }) {
  const submit = useSubmitConductReport();
  const [member, setMember] = useState<ReportSubjectOption | null>(null);
  const [unknownName, setUnknownName] = useState(false);
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [location, setLocation] = useState("");
  const [body, setBody] = useState("");
  const [possibleScoc, setPossibleScoc] = useState(false);

  const input = {
    ...(unknownName
      ? { subjectDescription: description }
      : member === null
        ? {}
        : { subjectPublicId: member.publicId }),
    occurredOn,
    location,
    body,
    possibleScoc,
  } as SubmitReportInput;
  const valid = submitReportSchema.safeParse(input).success;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) {
          return;
        }
        submit.mutate(input, { onSuccess: onSubmitted });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={unknownName ? "report-description" : "report-member"}>
          Who is this about?
        </Label>
        {unknownName ? (
          <Textarea
            id="report-description"
            value={description}
            maxLength={CONDUCT_LIMITS.descriptionMax}
            placeholder="Anything that would help identify them"
            onChange={(e) => setDescription(e.target.value)}
          />
        ) : (
          <MemberPicker selected={member} onSelect={setMember} />
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="report-unknown"
            checked={unknownName}
            onCheckedChange={(checked) => setUnknownName(checked === true)}
          />
          <Label htmlFor="report-unknown" className="font-normal">
            I don&apos;t know their name
          </Label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="report-date">When did it happen?</Label>
          <Input
            id="report-date"
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="report-location">Where? (optional)</Label>
          <Input
            id="report-location"
            value={location}
            maxLength={CONDUCT_LIMITS.locationMax}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="report-body">What happened?</Label>
        <Textarea
          id="report-body"
          rows={6}
          value={body}
          maxLength={CONDUCT_LIMITS.bodyMax}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="report-scoc"
          checked={possibleScoc}
          onCheckedChange={(checked) => setPossibleScoc(checked === true)}
        />
        <Label htmlFor="report-scoc" className="font-normal leading-snug">
          This may violate the Student Code of Conduct (harassment, hazing,
          assault, or similar)
        </Label>
      </div>
      {submit.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {submit.error.message}
        </p>
      ) : null}
      <Button type="submit" disabled={!valid || submit.isPending}>
        {submit.isPending ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}

/**
 * The member-facing "Report a conduct concern" dialog. The header says
 * plainly that the report goes to the Executive Committee with the
 * reporter's name attached, and points at UC's own channels. After
 * submitting the reporter sees a confirmation and nothing else: reports
 * are not readable by the member who filed them.
 */
export function ReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [done, setDone] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setDone(false);
        }
      }}
    >
      <DialogContent size="2xl" className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a conduct concern</DialogTitle>
          {done ? null : (
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This goes to the Executive Committee with your name attached.
                  For an anonymous report, or for sexual harassment or
                  discrimination, use UC&apos;s own channels:{" "}
                  <a
                    className="underline"
                    href={UC_TITLE_IX_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    UC Title IX and reporting
                  </a>{" "}
                  or{" "}
                  <a
                    className="underline"
                    href={UC_ANONYMOUS_REPORT_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    UC anonymous reporting
                  </a>
                  .
                </p>
                <p>
                  In an emergency, call 911 or UCPD at 513-556-1111. This form
                  is not watched around the clock.
                </p>
              </div>
            </DialogDescription>
          )}
        </DialogHeader>
        {done ? (
          <div className="space-y-4">
            <p>Thanks — the Executive Committee will review this.</p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <ReportForm onSubmitted={() => setDone(true)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

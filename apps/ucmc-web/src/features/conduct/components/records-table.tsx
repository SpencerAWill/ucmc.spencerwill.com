import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MailWarning } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { cn } from "#/lib/utils";
import { conductRecordsQueryOptions } from "#/features/conduct/api/queries";
import {
  LEVEL_FILL,
  SeverityMark,
} from "#/features/conduct/components/severity-mark";
import type { ConductLevelKey } from "#/features/conduct/components/severity-mark";
import { formatClubDate, formatDateRange } from "#/features/conduct/lib/format";
import { CONDUCT_LEVEL_LABELS } from "#/features/conduct/server/limits";
import type { ListRecordsFilter } from "#/features/conduct/server/limits";
import type { ConductRecordSummary } from "#/features/conduct/server/record-fns";

type LevelFilter = "all" | ConductLevelKey;
type StatusFilter = "all" | "active" | "lifted" | "referred";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "lifted", label: "Lifted" },
  { value: "referred", label: "Referred" },
];

function filterFor(
  level: LevelFilter,
  status: StatusFilter,
): ListRecordsFilter {
  return {
    ...(level === "all" ? {} : { level }),
    ...(status === "active" ? { active: true } : {}),
    ...(status === "lifted" ? { lifted: true } : {}),
    ...(status === "referred" ? { referred: true } : {}),
  };
}

/**
 * The record's state as filed: lifted, with SCCS, or open. Whether an
 * open record is in force today is the server's question (the Active
 * filter, and `standing.server.ts`), never this component's.
 */
function StatusBadge({ record }: { record: ConductRecordSummary }) {
  if (record.liftedAt) {
    return <Badge variant="outline">Lifted</Badge>;
  }
  if (record.scocState === "referred") {
    return <Badge variant="warning">Referred to SCCS</Badge>;
  }
  return <Badge variant="secondary">Open</Badge>;
}

/** A warning, suspension or termination whose email never went out. */
function noticeMissing(record: ConductRecordSummary): boolean {
  return (
    record.level !== "note" &&
    record.liftedAt === null &&
    record.noticeSentAt === null
  );
}

function NoticeMissingFlag() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
      <MailWarning aria-hidden="true" className="size-3.5" />
      Notice not sent
    </span>
  );
}

function SubjectLink({ record }: { record: ConductRecordSummary }) {
  return (
    <Link
      to="/conduct/$publicId"
      params={{ publicId: record.publicId }}
      className="font-medium underline-offset-4 hover:underline"
    >
      {record.subjectName}
    </Link>
  );
}

function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={label}
        value={value}
        // A single toggle group reports "" when the pressed item is
        // pressed again; the filter always has a value, so ignore it.
        onValueChange={(next) => {
          if (next !== "") {
            onChange(next as T);
          }
        }}
        className="flex-wrap"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="px-3"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * The records list. A table from `sm` up, for scanning levels and dates
 * down the list; stacked rows below it, where the task is finding one
 * member and opening their record (`web-architecture.md`).
 */
export function RecordsTable() {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const { data, isPending, isError } = useQuery(
    conductRecordsQueryOptions(filterFor(level, status)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
        <FilterChips<LevelFilter>
          label="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All" },
            ...Object.entries(CONDUCT_LEVEL_LABELS).map(([value, text]) => ({
              value: value as ConductLevelKey,
              label: text,
            })),
          ]}
        />
        <FilterChips<StatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS}
        />
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load records.
        </p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading records…</p>
      ) : data.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No records match.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-md border sm:hidden">
            {data.map((record) => (
              <li
                key={record.publicId}
                className="relative space-y-1.5 py-3 pr-3 pl-5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    LEVEL_FILL[record.level],
                  )}
                />
                <div className="flex items-center justify-between gap-2">
                  <SubjectLink record={record} />
                  <StatusBadge record={record} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <SeverityMark
                    level={record.level}
                    className="text-foreground"
                  />
                  <span>
                    {formatDateRange(record.startsOn, record.endsOn) ||
                      `Opened ${formatClubDate(record.createdAt)}`}
                  </span>
                </div>
                {noticeMissing(record) ? <NoticeMissingFlag /> : null}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Member</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((record) => (
                  <TableRow key={record.publicId}>
                    <TableCell className="relative pl-5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-y-0 left-0 w-1",
                          LEVEL_FILL[record.level],
                        )}
                      />
                      <SubjectLink record={record} />
                    </TableCell>
                    <TableCell>
                      <SeverityMark level={record.level} />
                    </TableCell>
                    <TableCell>
                      {formatDateRange(record.startsOn, record.endsOn) || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge record={record} />
                        {noticeMissing(record) ? <NoticeMissingFlag /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatClubDate(record.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

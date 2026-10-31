import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Label } from "#/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { conductRecordsQueryOptions } from "#/features/conduct/api/queries";
import { formatDateRange } from "#/features/conduct/lib/format";
import {
  CONDUCT_LEVEL_LABELS,
  listRecordsSchema,
} from "#/features/conduct/server/limits";
import type { ListRecordsFilter } from "#/features/conduct/server/limits";
import type { ConductRecordSummary } from "#/features/conduct/server/record-fns";

type StatusFilter = "all" | "not_lifted" | "lifted" | "referred";

function filterFor(level: string, status: StatusFilter): ListRecordsFilter {
  const filter: ListRecordsFilter = {};
  const parsedLevel = listRecordsSchema.shape.level.safeParse(level);
  if (parsedLevel.success) {
    filter.level = parsedLevel.data;
  }
  if (status === "not_lifted") {
    filter.active = true;
  } else if (status === "lifted") {
    filter.active = false;
  } else if (status === "referred") {
    filter.referred = true;
  }
  return filter;
}

function StatusBadge({ record }: { record: ConductRecordSummary }) {
  if (record.liftedAt) {
    return <Badge variant="outline">Lifted</Badge>;
  }
  if (record.scocState === "referred") {
    return <Badge variant="warning">Referred to SCCS</Badge>;
  }
  return <Badge variant="secondary">Not lifted</Badge>;
}

/** The records list with level and status filters. */
export function RecordsTable() {
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const { data, isPending, isError } = useQuery(
    conductRecordsQueryOptions(filterFor(level, status)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="filter-level">Level</Label>
          <NativeSelect
            id="filter-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <NativeSelectOption value="all">All levels</NativeSelectOption>
            {Object.entries(CONDUCT_LEVEL_LABELS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="filter-status">Status</Label>
          <NativeSelect
            id="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <NativeSelectOption value="all">All</NativeSelectOption>
            <NativeSelectOption value="not_lifted">
              Not lifted
            </NativeSelectOption>
            <NativeSelectOption value="lifted">Lifted</NativeSelectOption>
            <NativeSelectOption value="referred">
              Referred to SCCS
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load records.
        </p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading records…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No records match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((record) => (
              <TableRow key={record.publicId}>
                <TableCell>
                  <Link
                    to="/conduct/$publicId"
                    params={{ publicId: record.publicId }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {record.subjectName}
                  </Link>
                </TableCell>
                <TableCell>{CONDUCT_LEVEL_LABELS[record.level]}</TableCell>
                <TableCell>
                  {formatDateRange(record.startsOn, record.endsOn)}
                </TableCell>
                <TableCell>
                  <StatusBadge record={record} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

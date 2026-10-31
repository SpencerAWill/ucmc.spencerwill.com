import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Label } from "#/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "#/components/ui/native-select";
import { useAuth } from "#/features/auth/api/use-auth";
import { conductReportsQueryOptions } from "#/features/conduct/api/queries";
import { TriageActions } from "#/features/conduct/components/triage-actions";
import { formatPlainDate } from "#/features/conduct/lib/format";
import type { ConductReportSummary } from "#/features/conduct/server/report-fns";

type StatusFilter = "all" | "new" | "accepted" | "dismissed";

function StatusBadge({ report }: { report: ConductReportSummary }) {
  if (report.status === "new") {
    return <Badge variant="warning">New</Badge>;
  }
  return (
    <Badge variant={report.status === "accepted" ? "secondary" : "outline"}>
      {report.status === "accepted" ? "Accepted" : "Dismissed"}
    </Badge>
  );
}

function ReportCard({
  report,
  canManage,
}: {
  report: ConductReportSummary;
  canManage: boolean;
}) {
  return (
    <li className="space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge report={report} />
        {report.possibleScoc ? (
          <Badge variant="warning">Possible SCOC violation</Badge>
        ) : null}
        <span className="font-medium">
          {report.subjectName ??
            (report.subjectDescription
              ? `Unnamed: ${report.subjectDescription}`
              : "Unknown member")}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {formatPlainDate(report.occurredOn)}
        {report.location ? ` · ${report.location}` : ""} · reported by{" "}
        {report.reporterName ?? "a former member"}
      </p>
      <p className="whitespace-pre-wrap text-sm">{report.body}</p>
      {report.status === "dismissed" && report.dismissReason ? (
        <p className="text-sm text-muted-foreground">
          Dismissed: {report.dismissReason}
        </p>
      ) : null}
      {canManage && report.status === "new" ? (
        <TriageActions report={report} />
      ) : null}
    </li>
  );
}

/** The reports list, `new` first. Triage controls need `conduct:manage`. */
export function ReportsTable() {
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState<StatusFilter>("all");
  const { data, isPending, isError } = useQuery(
    conductReportsQueryOptions(status === "all" ? undefined : status),
  );
  const canManage = hasPermission("conduct:manage");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Label htmlFor="filter-report-status">Status</Label>
        <NativeSelect
          id="filter-report-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <NativeSelectOption value="all">All</NativeSelectOption>
          <NativeSelectOption value="new">New</NativeSelectOption>
          <NativeSelectOption value="accepted">Accepted</NativeSelectOption>
          <NativeSelectOption value="dismissed">Dismissed</NativeSelectOption>
        </NativeSelect>
      </div>
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load reports.
        </p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reports match.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((report) => (
            <ReportCard key={report.id} report={report} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

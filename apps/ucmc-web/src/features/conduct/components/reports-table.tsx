import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, ShieldAlert, UserRound } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { cn } from "#/lib/utils";
import { useAuth } from "#/features/auth/api/use-auth";
import { conductReportsQueryOptions } from "#/features/conduct/api/queries";
import { TriageActions } from "#/features/conduct/components/triage-actions";
import { formatPlainDate } from "#/features/conduct/lib/format";
import type { ConductReportSummary } from "#/features/conduct/server/report-fns";

type StatusFilter = "all" | "new" | "accepted" | "dismissed";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "dismissed", label: "Dismissed" },
];

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

function subjectLabel(report: ConductReportSummary): string {
  if (report.subjectName) {
    return report.subjectName;
  }
  return report.subjectDescription
    ? `Unnamed: ${report.subjectDescription}`
    : "Unknown member";
}

function ReportCard({
  report,
  canManage,
}: {
  report: ConductReportSummary;
  canManage: boolean;
}) {
  const isNew = report.status === "new";
  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        // A new report is the one waiting on exec.
        isNew && "border-l-4 border-l-conduct-warning",
      )}
    >
      {report.possibleScoc ? (
        <p className="flex items-center gap-2 bg-notice-warning px-4 py-2 text-sm font-medium text-notice-warning-foreground">
          <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
          Possible SCOC violation · goes to SCCS
        </p>
      ) : null}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{subjectLabel(report)}</h2>
          <StatusBadge report={report} />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {formatPlainDate(report.occurredOn)}
          </li>
          {report.location ? (
            <li className="flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-3.5" />
              {report.location}
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <UserRound aria-hidden="true" className="size-3.5" />
            Reported by {report.reporterName ?? "a former member"}
          </li>
        </ul>
        <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap">
          {report.body}
        </blockquote>
        {report.status === "dismissed" && report.dismissReason ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Dismissed:</span>{" "}
            {report.dismissReason}
          </p>
        ) : null}
      </div>
      {canManage && isNew ? (
        <div className="border-t bg-muted/40 px-4 py-3">
          <TriageActions report={report} />
        </div>
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Status
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Status"
          value={status}
          onValueChange={(next) => {
            if (next !== "") {
              setStatus(next as StatusFilter);
            }
          }}
          className="flex-wrap"
        >
          {STATUS_FILTERS.map((option) => (
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
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load reports.
        </p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : data.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No reports match.
        </p>
      ) : (
        <ul className="space-y-4">
          {data.map((report) => (
            <ReportCard key={report.id} report={report} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

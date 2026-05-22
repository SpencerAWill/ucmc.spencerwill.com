import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { IssueCard } from "#/features/gazette/components/issue-card";
import type { GazetteIssueSummary } from "#/features/gazette/server/gazette-fns";

const ALL_YEARS_VALUE = "__all__";

/**
 * Goosedown Gazette browse surface — a year-filter dropdown over the
 * issue archive. Server returns issues sorted (start_year DESC,
 * issue_number DESC), so the dropdown is populated from the
 * distinct school_years it sees and the cards within a year are
 * already in newest-first order.
 *
 * When `canManage` is true, each card grows pencil + trash buttons
 * that emit callbacks to the parent (which hosts the form-dialog
 * and delete-confirm state).
 */
export function GazetteList({
  issues,
  canManage = false,
  onEditIssue,
  onDeleteIssue,
}: {
  issues: GazetteIssueSummary[];
  canManage?: boolean;
  onEditIssue?: (issue: GazetteIssueSummary) => void;
  onDeleteIssue?: (issue: GazetteIssueSummary) => void;
}) {
  // Distinct school years in display order (already newest-first
  // because the server query sorts by start_year DESC).
  const yearsInOrder: string[] = [];
  for (const issue of issues) {
    if (!yearsInOrder.includes(issue.schoolYear)) {
      yearsInOrder.push(issue.schoolYear);
    }
  }

  const initialSelection = yearsInOrder[0] ?? ALL_YEARS_VALUE;
  const [selected, setSelected] = useState<string>(initialSelection);

  if (issues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Gazette issues are on file yet.{" "}
        {canManage ? "Use Add issue to upload the first." : "Check back soon."}
      </p>
    );
  }

  const visible =
    selected === ALL_YEARS_VALUE
      ? issues
      : issues.filter((i) => i.schoolYear === selected);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="gazette-year"
          className="text-sm font-medium text-muted-foreground"
        >
          Show
        </label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="gazette-year" className="w-[14rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS_VALUE}>
              All years ({yearsInOrder.length})
            </SelectItem>
            {yearsInOrder.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="space-y-3">
        {visible.map((issue) => (
          <li key={issue.publicId}>
            <IssueCard
              issue={issue}
              canManage={canManage}
              onEdit={onEditIssue}
              onDelete={onDeleteIssue}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { useSyncSiteFeedbackIssues } from "#/features/site-feedback/api/use-sync-site-feedback-issues";
import type { SiteFeedbackIssueSummary } from "#/features/site-feedback/server/site-feedback-triage-fns";
import { formatRelative } from "#/lib/date-format";

export interface TriageIssueRailProps {
  drafts: SiteFeedbackIssueSummary[];
  openIssues: SiteFeedbackIssueSummary[];
  githubConfigured: boolean;
  lastSyncedAt: Temporal.Instant | null;
}

function reportsLabel(n: number): string {
  return `${n} ${n === 1 ? "report" : "reports"}`;
}

function IssueList({
  heading,
  issues,
  empty,
}: {
  heading: string;
  issues: SiteFeedbackIssueSummary[];
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {heading}{" "}
        <span className="text-muted-foreground">({issues.length})</span>
      </h2>
      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                to="/feedback/site/triage/issues/$issueId"
                params={{ issueId: issue.id }}
                className="block rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <span className="block font-medium">{issue.title}</span>
                <span className="text-xs text-muted-foreground">
                  {issue.githubNumber === null
                    ? null
                    : `#${issue.githubNumber} · `}
                  {reportsLabel(issue.reportCount)}
                  {issue.unpostedCount > 0 && issue.githubNumber !== null
                    ? ` · ${issue.unpostedCount} unposted`
                    : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Right rail of the triage page: drafts, filed issues, and GitHub sync. */
export function TriageIssueRail({
  drafts,
  openIssues,
  githubConfigured,
  lastSyncedAt,
}: TriageIssueRailProps) {
  const sync = useSyncSiteFeedbackIssues();

  const onSync = () => {
    sync.mutate(undefined, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(
            `Checked ${result.checked} ${result.checked === 1 ? "issue" : "issues"}, ${result.closed} closed`,
          );
        } else {
          toast.error("GitHub isn't configured.");
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <IssueList
        heading="Drafts"
        issues={drafts}
        empty="No drafts. Select reports and start one."
      />
      <IssueList
        heading="Filed (open)"
        issues={openIssues}
        empty="No open issues."
      />
      <div className="space-y-2 border-t pt-3">
        {githubConfigured ? null : (
          <p className="text-sm text-muted-foreground">
            GitHub isn&apos;t configured, so filing and sync are off
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!githubConfigured || sync.isPending}
            onClick={onSync}
          >
            <RefreshCw
              className={sync.isPending ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Sync now
          </Button>
          <span className="text-xs text-muted-foreground">
            {lastSyncedAt === null
              ? "Never synced"
              : `Last synced ${formatRelative(lastSyncedAt)}`}
          </span>
        </div>
        {sync.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Sync failed: {sync.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

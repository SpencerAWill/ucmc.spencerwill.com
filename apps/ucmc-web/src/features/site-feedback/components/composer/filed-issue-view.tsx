import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { useFileSiteFeedbackIssue } from "#/features/site-feedback/api/use-file-site-feedback-issue";
import { PostPendingDialog } from "#/features/site-feedback/components/composer/post-pending-dialog";
import { ReportRow } from "#/features/site-feedback/components/composer/report-row";
import { SITE_FEEDBACK_FILING_STALE_MS } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * A `filing` issue: in progress while the claim is fresh, and a retry once it
 * is stale (the server only re-claims after `SITE_FEEDBACK_FILING_STALE_MS`,
 * and the retry adopts an issue the first attempt may already have filed).
 */
function FilingStatus({ issue }: { issue: SiteFeedbackIssueDetail }) {
  const file = useFileSiteFeedbackIssue();
  const [message, setMessage] = useState<string | null>(null);
  const stale =
    issue.filingStartedAt === null ||
    Temporal.Now.instant().epochMilliseconds -
      issue.filingStartedAt.epochMilliseconds >
      SITE_FEEDBACK_FILING_STALE_MS;

  if (!stale) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Filing in progress…
      </p>
    );
  }

  const onRetry = async () => {
    setMessage(null);
    try {
      const result = await file.mutateAsync(issue.id);
      if (result.ok) {
        toast.success(`Filed as #${result.number}`);
      } else {
        setMessage(result.message);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Filing failed");
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm">Filing didn&apos;t finish.</p>
      <Button
        type="button"
        disabled={!issue.githubConfigured || file.isPending}
        onClick={() => void onRetry()}
      >
        Retry filing
      </Button>
      {message === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** Read-only view of an issue that has been filed on GitHub. */
export function FiledIssueView({ issue }: { issue: SiteFeedbackIssueDetail }) {
  const posted = issue.links.filter((l) => l.postedAt !== null);
  const unposted = issue.links.filter((l) => l.postedAt === null);
  const canPost = issue.githubConfigured && issue.state === "open";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">{issue.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {issue.githubNumber === null ? "" : `#${issue.githubNumber} · `}
            {issue.state}
          </span>
          {issue.githubUrl === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <a
                href={issue.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                View on GitHub
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Edits made here after posting don&apos;t change GitHub.
        </p>
      </header>

      {issue.state === "filing" ? <FilingStatus issue={issue} /> : null}

      {issue.summaryMd === null || issue.summaryMd.trim() === "" ? null : (
        <MarkdownContent>{issue.summaryMd}</MarkdownContent>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Posted ({posted.length})</h3>
        <ul className="space-y-2">
          {posted.map((link) => (
            <ReportRow
              key={link.feedbackId}
              issueId={issue.id}
              link={link}
              editable={false}
            />
          ))}
        </ul>
      </section>

      {unposted.length === 0 ? null : (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Not posted yet</h3>
          <ul className="space-y-2">
            {unposted.map((link) => (
              <ReportRow
                key={link.feedbackId}
                issueId={issue.id}
                link={link}
                editable
              />
            ))}
          </ul>
          {issue.unpostedCount > 0 ? (
            <div className="space-y-1">
              <PostPendingDialog
                issueId={issue.id}
                count={issue.unpostedCount}
                repo={issue.githubRepo ?? ""}
                disabled={!canPost}
              />
              {issue.githubConfigured ? null : (
                <p className="text-sm text-muted-foreground">
                  GitHub isn&apos;t configured, so posting is off.
                </p>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

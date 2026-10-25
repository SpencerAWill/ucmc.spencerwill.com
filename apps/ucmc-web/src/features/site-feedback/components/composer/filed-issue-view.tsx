import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { usePostPendingSiteFeedbackReports } from "#/features/site-feedback/api/use-post-pending-site-feedback-reports";
import { ReportRow } from "#/features/site-feedback/components/composer/report-row";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

/** Read-only view of an issue that has been filed on GitHub. */
export function FiledIssueView({ issue }: { issue: SiteFeedbackIssueDetail }) {
  const post = usePostPendingSiteFeedbackReports();
  const posted = issue.links.filter((l) => l.postedAt !== null);
  const unposted = issue.links.filter((l) => l.postedAt === null);
  const canPost = issue.githubConfigured && issue.state === "open";

  const onPost = async () => {
    try {
      const result = await post.mutateAsync(issue.id);
      if (result.ok) {
        toast.success(
          `Posted ${result.posted} ${result.posted === 1 ? "report" : "reports"}`,
        );
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post");
    }
  };

  const failure =
    post.data !== undefined && !post.data.ok ? post.data.message : null;

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
              <Button
                type="button"
                disabled={!canPost || post.isPending}
                onClick={() => void onPost()}
              >
                Post {issue.unpostedCount} new{" "}
                {issue.unpostedCount === 1 ? "report" : "reports"}
              </Button>
              {issue.githubConfigured ? null : (
                <p className="text-sm text-muted-foreground">
                  GitHub isn&apos;t configured, so posting is off.
                </p>
              )}
              {failure === null ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

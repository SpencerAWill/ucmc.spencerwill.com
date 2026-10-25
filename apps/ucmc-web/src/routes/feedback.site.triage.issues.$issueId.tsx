import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { siteFeedbackIssueQueryOptions } from "#/features/site-feedback/api/queries";
import { FiledIssueView } from "#/features/site-feedback/components/composer/filed-issue-view";
import { IssueDraftEditor } from "#/features/site-feedback/components/composer/issue-draft-editor";
import { RelatedPanel } from "#/features/site-feedback/components/composer/related-panel";

export const Route = createFileRoute("/feedback/site/triage/issues/$issueId")({
  beforeLoad: async ({ context, location, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermission({ context, location }, "site_feedback:manage");
  },
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(
        siteFeedbackIssueQueryOptions(params.issueId),
      );
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        throw notFound();
      }
      throw err;
    }
  },
  component: IssueComposerPage,
});

function IssueComposerPage() {
  const { issueId } = Route.useParams();
  const query = useQuery(siteFeedbackIssueQueryOptions(issueId));
  const issue = query.data;

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load this issue: {query.error.message}
      </p>
    );
  }
  if (issue === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          to="/feedback/site/triage"
          className="text-sm text-muted-foreground underline"
        >
          Back to triage
        </Link>
        <h1 className="text-2xl font-semibold">
          {issue.state === "draft" ? "Draft issue" : "GitHub issue"}
        </h1>
      </header>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        {issue.state === "draft" ? (
          <IssueDraftEditor key={issue.id} issue={issue} />
        ) : (
          <FiledIssueView issue={issue} />
        )}
        <aside>
          <RelatedPanel
            issueId={issue.id}
            linkedIds={new Set(issue.links.map((l) => l.feedbackId))}
          />
        </aside>
      </div>
    </div>
  );
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowLeft, Download } from "lucide-react";

import { Button } from "#/components/ui/button";
import { requireViewPermission } from "#/features/auth/guards";
import { gazetteIssueQueryOptions } from "#/features/gazette/api/queries";
import {
  gazettePdfFilename,
  gazettePdfUrl,
} from "#/features/gazette/lib/pdf-url";

/**
 * Gazette issue detail page. View-gated by `public_gazette:view`
 * (route guard) — non-holders get the notFound boundary rather than
 * a redirect.
 *
 * Inline rendering of the PDF + CSP updates land in the follow-up
 * commit. This first pass surfaces metadata + a download link so the
 * Issue Card's "View" button has somewhere to navigate to.
 */
export const Route = createFileRoute("/gazette/$publicId")({
  beforeLoad: async ({ context }) => {
    await requireViewPermission(context.queryClient, "public_gazette:view");
  },
  loader: async ({ context, params }) => {
    const issue = await context.queryClient.ensureQueryData(
      gazetteIssueQueryOptions(params.publicId),
    );
    if (!issue) {
      throw notFound();
    }
  },
  component: GazetteIssuePage,
});

function GazetteIssuePage() {
  const { publicId } = Route.useParams();
  const { data: issue } = useSuspenseQuery(gazetteIssueQueryOptions(publicId));

  if (!issue) {
    return null;
  }

  const displayTitle =
    issue.title ?? `Issue #${issue.issueNumber} · ${issue.schoolYear}`;
  const downloadUrl = gazettePdfUrl(issue.pdfKey);
  const downloadName = gazettePdfFilename(issue.schoolYear, issue.issueNumber);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl space-y-6 px-6 py-12">
      <Button asChild variant="ghost" size="sm">
        <Link to="/gazette">
          <ArrowLeft className="size-4" />
          Back to Gazette archive
        </Link>
      </Button>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {displayTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {issue.schoolYear} · Issue {issue.issueNumber}
          {issue.editor ? ` · edited by ${issue.editor}` : null}
          {issue.publishedAt
            ? ` · published ${format(new Date(issue.publishedAt), "MMM d, yyyy")}`
            : null}
        </p>
        {issue.description ? (
          <p className="text-sm">{issue.description}</p>
        ) : null}
      </header>

      <Button asChild variant="default">
        <a href={downloadUrl} download={downloadName}>
          <Download className="size-4" />
          Download PDF
        </a>
      </Button>
    </main>
  );
}

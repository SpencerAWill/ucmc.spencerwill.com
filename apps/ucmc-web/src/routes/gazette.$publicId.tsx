import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, Download } from "lucide-react";

import { Button } from "#/components/ui/button";
import { requireViewPermission } from "#/features/auth/guards";
import { gazetteIssueQueryOptions } from "#/features/gazette/api/queries";
import {
  formatPublishedAt,
  gazettePdfFilename,
  gazettePdfUrl,
} from "#/features/gazette/lib/pdf-url";

/**
 * Gazette issue detail page. View-gated by `public_gazette:view`
 * (route guard) — non-holders get the notFound boundary rather than
 * a redirect.
 *
 * The inline `<iframe>` loads the PDF from the R2 custom domain
 * (`cdn.{dev.,}ucmc.spencerwill.com`). CSP's `frame-src` allow-lists
 * both hosts. The download `<a>` points at the same URL with the
 * `download` attribute; cross-origin means some browsers may ignore
 * the attribute and open the PDF inline regardless, but that's an
 * acceptable degradation since the iframe already covers inline
 * viewing.
 *
 * Mobile fallback: native browser PDF viewers vary in quality. The
 * iframe is still the primary surface — when iOS Safari refuses to
 * render it inline, users see the empty frame and the Download
 * button below as a recovery path.
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
            ? ` · published ${formatPublishedAt(issue.publishedAt)}`
            : null}
        </p>
        {issue.description ? (
          <p className="text-sm">{issue.description}</p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="default">
          <a href={downloadUrl} download={downloadName}>
            <Download className="size-4" />
            Download PDF
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
        </Button>
      </div>

      {/*
       * Bare iframe — no fallback children. iframe children are a
       * legacy mechanism for browsers that don't support frames at
       * all; React serializes them during SSR and the client then
       * sees an empty/HTML-rendered child, producing a hydration
       * mismatch. The "Download" + "Open in new tab" buttons above
       * already serve as the recovery path when a browser can't
       * display the PDF inline (notably iOS Safari).
       */}
      <div className="rounded-md border bg-muted/30">
        <iframe
          src={downloadUrl}
          title={`${displayTitle} — PDF reader`}
          className="block h-[80vh] w-full rounded-md"
        />
      </div>
    </main>
  );
}

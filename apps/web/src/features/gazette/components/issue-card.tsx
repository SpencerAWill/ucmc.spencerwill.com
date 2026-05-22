import { Link } from "@tanstack/react-router";
import { Download, FileText, Pencil, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  formatPublishedAtUtc,
  gazettePdfFilename,
  gazettePdfUrl,
} from "#/features/gazette/lib/pdf-url";
import type { GazetteIssueSummary } from "#/features/gazette/server/gazette-fns";

/**
 * One row in the /gazette list. Title falls back to a derived
 * "Issue #N · YYYY-YY" string when no explicit title is set, so
 * legacy backfilled rows with sparse metadata still read cleanly.
 *
 * "View" navigates to the detail route (`/gazette/$publicId`) for the
 * inline iframe reader. "Download" is a direct `<a download>` to the
 * R2 CDN URL — cross-origin so some browsers may open inline rather
 * than download, acceptable trade-off for MVP.
 */
export function IssueCard({
  issue,
  canManage = false,
  onEdit,
  onDelete,
}: {
  issue: GazetteIssueSummary;
  canManage?: boolean;
  onEdit?: (issue: GazetteIssueSummary) => void;
  onDelete?: (issue: GazetteIssueSummary) => void;
}) {
  const displayTitle =
    issue.title ?? `Issue #${issue.issueNumber} · ${issue.schoolYear}`;
  const downloadUrl = gazettePdfUrl(issue.pdfKey);
  const downloadName = gazettePdfFilename(issue.schoolYear, issue.issueNumber);

  return (
    <article className="space-y-2 rounded-md border border-border/60 bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold tracking-tight">{displayTitle}</p>
          <p className="text-xs text-muted-foreground">
            {issue.schoolYear} · Issue {issue.issueNumber}
            {issue.editor ? ` · edited by ${issue.editor}` : null}
            {issue.publishedAt
              ? ` · ${formatPublishedAtUtc(issue.publishedAt)}`
              : null}
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-1">
            {onEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Edit ${displayTitle}`}
                onClick={() => onEdit(issue)}
              >
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Delete ${displayTitle}`}
                onClick={() => onDelete(issue)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {issue.description ? (
        <p className="text-sm text-muted-foreground">{issue.description}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="default" size="sm">
          <Link to="/gazette/$publicId" params={{ publicId: issue.publicId }}>
            <FileText className="size-4" />
            View
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={downloadUrl} download={downloadName}>
            <Download className="size-4" />
            Download
          </a>
        </Button>
      </div>
    </article>
  );
}

import { ExternalLink } from "lucide-react";

import { MarkdownContent } from "#/components/markdown/markdown-content";
import { UserAvatar } from "#/components/user-avatar";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import type { SiteFeedbackSummary } from "#/features/site-feedback/server/site-feedback-fns";
import {
  SITE_FEEDBACK_KIND_LABELS,
  SITE_FEEDBACK_STATE_LABELS,
} from "#/features/site-feedback/server/limits";
import type { SiteFeedbackState } from "#/features/site-feedback/server/limits";
import { formatRelative } from "#/lib/date-format";

const STATE_VARIANTS: Record<
  SiteFeedbackState,
  "default" | "warning" | "success" | "secondary"
> = {
  new: "default",
  in_draft: "warning",
  tracked: "warning",
  resolved: "success",
  wont_fix: "secondary",
  duplicate: "secondary",
};

export function SiteFeedbackCard({
  entry,
  showSubmitter,
}: {
  entry: SiteFeedbackSummary;
  showSubmitter: boolean;
}) {
  const author = entry.authorDisplayName ?? "Unknown";

  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {SITE_FEEDBACK_KIND_LABELS[entry.kind]}
              </Badge>
              <Badge variant={STATE_VARIANTS[entry.state]}>
                {SITE_FEEDBACK_STATE_LABELS[entry.state]}
              </Badge>
              {entry.trackedIn.map((issue) => (
                <a
                  key={issue.number}
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  Tracked in #{issue.number}
                  <ExternalLink className="size-3" />
                </a>
              ))}
            </div>
            <h3 className="text-base font-semibold leading-tight">
              {entry.title}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {showSubmitter ? (
                <>
                  <UserAvatar
                    avatarKey={entry.authorAvatarKey}
                    name={author}
                    className="size-5"
                    fallbackClassName="text-[10px]"
                  />
                  <span>{author}</span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <time dateTime={entry.createdAt.toString()}>
                {formatRelative(entry.createdAt)}
              </time>
            </div>
          </div>
        </div>
        <MarkdownContent>{entry.body}</MarkdownContent>
      </CardContent>
    </Card>
  );
}

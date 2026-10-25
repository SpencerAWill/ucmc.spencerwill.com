import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { MarkdownContent } from "#/components/markdown/markdown-content";
import { UserAvatar } from "#/components/user-avatar";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useUpdateSiteFeedbackStatus } from "#/features/site-feedback/api/use-update-site-feedback-status";
import type { SiteFeedbackSummary } from "#/features/site-feedback/server/site-feedback-fns";
import {
  SITE_FEEDBACK_KIND_LABELS,
  SITE_FEEDBACK_STATUS_LABELS,
  SITE_FEEDBACK_STATUS_VALUES,
} from "#/features/site-feedback/server/limits";
import type { SiteFeedbackStatus } from "#/features/site-feedback/server/limits";
import { formatRelative } from "#/lib/date-format";

const STATUS_VARIANTS: Record<
  SiteFeedbackStatus,
  "default" | "warning" | "success" | "secondary"
> = {
  open: "default",
  acknowledged: "warning",
  resolved: "success",
  closed: "secondary",
  wont_fix: "secondary",
  duplicate: "secondary",
};

export function SiteFeedbackCard({
  entry,
  showSubmitter,
  canManage,
}: {
  entry: SiteFeedbackSummary;
  showSubmitter: boolean;
  canManage: boolean;
}) {
  const updateStatus = useUpdateSiteFeedbackStatus();

  const onChangeStatus = (next: string) => {
    updateStatus.mutate(
      { id: entry.id, status: next as SiteFeedbackStatus },
      {
        onSuccess: () => {
          toast.success(
            `Marked ${SITE_FEEDBACK_STATUS_LABELS[next as SiteFeedbackStatus].toLowerCase()}`,
          );
        },
        onError: () => {
          toast.error("Couldn’t update status. Please try again.");
        },
      },
    );
  };

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
              {canManage ? (
                <Select
                  value={entry.status}
                  onValueChange={onChangeStatus}
                  disabled={updateStatus.isPending}
                >
                  <SelectTrigger size="sm" className="h-7 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SITE_FEEDBACK_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SITE_FEEDBACK_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={STATUS_VARIANTS[entry.status]}>
                  {SITE_FEEDBACK_STATUS_LABELS[entry.status]}
                </Badge>
              )}
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

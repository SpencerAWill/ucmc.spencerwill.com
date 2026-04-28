import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

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
import { useUpdateFeedbackStatus } from "#/features/feedback/api/use-update-feedback-status";
import type { FeedbackSummary } from "#/features/feedback/server/feedback-fns";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_VALUES,
} from "#/features/feedback/server/limits";
import type { FeedbackStatus } from "#/features/feedback/server/limits";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

function formatRelative(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  for (const { unit, ms } of UNITS) {
    if (abs >= ms) {
      return RELATIVE.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

const STATUS_VARIANTS: Record<
  FeedbackStatus,
  "default" | "secondary" | "outline"
> = {
  open: "default",
  acknowledged: "secondary",
  resolved: "outline",
  closed: "outline",
};

export function FeedbackCard({
  entry,
  showSubmitter,
  canManage,
}: {
  entry: FeedbackSummary;
  showSubmitter: boolean;
  canManage: boolean;
}) {
  const updateStatus = useUpdateFeedbackStatus();

  const onChangeStatus = (next: string) => {
    updateStatus.mutate(
      { id: entry.id, status: next as FeedbackStatus },
      {
        onSuccess: () => {
          toast.success(
            `Marked ${FEEDBACK_STATUS_LABELS[next as FeedbackStatus].toLowerCase()}`,
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
                {FEEDBACK_KIND_LABELS[entry.kind]}
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
                    {FEEDBACK_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {FEEDBACK_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={STATUS_VARIANTS[entry.status]}>
                  {FEEDBACK_STATUS_LABELS[entry.status]}
                </Badge>
              )}
              {entry.githubIssueUrl ? (
                <a
                  href={entry.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  #{entry.githubIssueNumber}
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
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
              <time dateTime={entry.createdAt.toISOString()}>
                {formatRelative(entry.createdAt)}
              </time>
            </div>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {entry.body}
        </p>
      </CardContent>
    </Card>
  );
}

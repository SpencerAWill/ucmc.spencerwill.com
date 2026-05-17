import { EyeOff } from "lucide-react";
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
import { useUpdateClubFeedbackStatus } from "#/features/club-feedback/api/use-update-club-feedback-status";
import type { ClubFeedbackSummary } from "#/features/club-feedback/server/club-feedback-fns";
import {
  CLUB_FEEDBACK_KIND_LABELS,
  CLUB_FEEDBACK_STATUS_LABELS,
  CLUB_FEEDBACK_STATUS_VALUES,
} from "#/features/club-feedback/server/limits";
import type { ClubFeedbackStatus } from "#/features/club-feedback/server/limits";

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
  ClubFeedbackStatus,
  "default" | "warning" | "success" | "secondary"
> = {
  open: "default",
  acknowledged: "warning",
  resolved: "success",
  closed: "secondary",
};

/**
 * One club-feedback row.
 *
 * Submitter display rules:
 *   - For managers viewing an anonymous row, the server has already
 *     stripped `authorDisplayName` / `createdBy` / `authorAvatarKey`,
 *     so we render an "Anonymous" pill instead of an avatar+name.
 *   - Owners viewing their own anonymous row get their identity back
 *     from the server (createdBy === viewer), with a small "hidden
 *     from officers" badge so they remember the submission is anon.
 *   - Non-anonymous rows render normally.
 */
export function ClubFeedbackCard({
  entry,
  showSubmitter,
  canManage,
  isOwn,
}: {
  entry: ClubFeedbackSummary;
  showSubmitter: boolean;
  canManage: boolean;
  isOwn: boolean;
}) {
  const updateStatus = useUpdateClubFeedbackStatus();

  const onChangeStatus = (next: string) => {
    updateStatus.mutate(
      { id: entry.id, status: next as ClubFeedbackStatus },
      {
        onSuccess: () => {
          toast.success(
            `Marked ${CLUB_FEEDBACK_STATUS_LABELS[next as ClubFeedbackStatus].toLowerCase()}`,
          );
        },
        onError: () => {
          toast.error("Couldn’t update status. Please try again.");
        },
      },
    );
  };

  // For an anonymous row, the server only ships identity columns to the
  // owner. `authorDisplayName === null` for everyone else is the wire
  // signal; we don't reach for any join data here.
  const isRedactedForViewer =
    entry.anonymous && entry.authorDisplayName === null;
  const author = entry.authorDisplayName ?? "Anonymous member";

  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {CLUB_FEEDBACK_KIND_LABELS[entry.kind]}
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
                    {CLUB_FEEDBACK_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {CLUB_FEEDBACK_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={STATUS_VARIANTS[entry.status]}>
                  {CLUB_FEEDBACK_STATUS_LABELS[entry.status]}
                </Badge>
              )}
              {entry.anonymous && isOwn ? (
                <Badge variant="secondary" className="gap-1">
                  <EyeOff className="size-3" />
                  Hidden from officers
                </Badge>
              ) : null}
            </div>
            <h3 className="text-base leading-tight font-semibold">
              {entry.title}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {showSubmitter ? (
                <>
                  {isRedactedForViewer ? (
                    <Badge variant="outline" className="gap-1 px-2 py-0">
                      <EyeOff className="size-3" />
                      Anonymous
                    </Badge>
                  ) : (
                    <>
                      <UserAvatar
                        avatarKey={entry.authorAvatarKey}
                        name={author}
                        className="size-5"
                        fallbackClassName="text-[10px]"
                      />
                      <span>{author}</span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <time dateTime={entry.createdAt.toISOString()}>
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

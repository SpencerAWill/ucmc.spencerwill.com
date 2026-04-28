import { MoreVertical, Pencil, Trash2 } from "lucide-react";

import { UserAvatar } from "#/components/user-avatar";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import type { AnnouncementSummary } from "#/features/announcements/server/announcements-fns";

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

export function AnnouncementCard({
  announcement,
  canManage,
  onEdit,
  onDelete,
}: {
  announcement: AnnouncementSummary;
  canManage: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const author = announcement.authorDisplayName ?? "Unknown";
  const edited =
    announcement.updatedAt.getTime() - announcement.publishedAt.getTime() >
    1000;

  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold leading-tight">
              {announcement.title}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserAvatar
                avatarKey={announcement.authorAvatarKey}
                name={author}
                className="size-5"
                fallbackClassName="text-[10px]"
              />
              <span>{author}</span>
              <span aria-hidden>·</span>
              <time dateTime={announcement.publishedAt.toISOString()}>
                {formatRelative(announcement.publishedAt)}
              </time>
              {edited ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="italic">edited</span>
                </>
              ) : null}
            </div>
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="Announcement actions"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} variant="destructive">
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {announcement.body}
        </p>
      </CardContent>
    </Card>
  );
}

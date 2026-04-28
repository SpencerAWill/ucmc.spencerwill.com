import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { announcementsUnreadQueryOptions } from "#/features/announcements/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";

export function AnnouncementsBell() {
  const { hasPermission, isAuthenticated } = useAuth();
  const canRead = hasPermission("announcements:read");

  const { data } = useQuery(
    announcementsUnreadQueryOptions({ enabled: isAuthenticated && canRead }),
  );

  if (!canRead) {
    return null;
  }

  const count = data?.count ?? 0;
  const display = count > 99 ? "99+" : String(count);

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link to="/announcements" aria-label="Announcements">
        <Bell className="h-[1.2rem] w-[1.2rem]" />
        {count > 0 ? (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none"
            aria-label={`${count} unread`}
          >
            {display}
          </Badge>
        ) : null}
      </Link>
    </Button>
  );
}

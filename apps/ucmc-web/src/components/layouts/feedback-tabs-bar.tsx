/**
 * Tab bar rendered by the `/feedback/_tabs` pathless layout. Bridges the
 * `features/feedback` (website) and `features/club-feedback` (governance)
 * surfaces — lives outside both features so neither has to cross-import
 * the other.
 *
 * Per-tab visibility: a user sees a tab if they hold *either* its
 * `*:submit` or `*:manage` permission. The corresponding setting flag
 * (`feedback.website_enabled` / `feedback.club_enabled`) does NOT hide
 * the tab for a manager — they still need access to the triage view of
 * existing rows while submissions are paused. For a plain submitter, a
 * disabled flag is enforced server-side (the action throws); the route
 * guard separately decides whether to surface the tab at all.
 *
 * If a viewer has neither feedback nor club-feedback access, this
 * component returns `null` (the layout will have already redirected
 * them away — this is defense in depth).
 */
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";

export type FeedbackTabId = "website" | "club";

export function activeFeedbackTabFromPath(pathname: string): FeedbackTabId {
  if (pathname.startsWith("/feedback/club")) return "club";
  return "website";
}

const TAB_SUBTITLES: Record<FeedbackTabId, string> = {
  website:
    "Found a bug, have an idea for the site, or want to share something about how it works? Send it here.",
  club: "Have a suggestion, concern, or kudos for the exec board? This goes directly to club leadership — not website maintainers.",
};

export function getFeedbackTabSubtitle(pathname: string): string {
  return TAB_SUBTITLES[activeFeedbackTabFromPath(pathname)];
}

export function FeedbackTabsBar() {
  const { hasPermission } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });

  const canSeeWebsite =
    hasPermission("feedback:submit") || hasPermission("feedback:manage");
  const canSeeClub =
    hasPermission("club_feedback:submit") ||
    hasPermission("club_feedback:manage");

  // If the viewer only has access to one tab the bar is just noise.
  if (!(canSeeWebsite && canSeeClub)) {
    return null;
  }

  const active = activeFeedbackTabFromPath(pathname);

  return (
    <div className="flex gap-1 rounded-md border p-1">
      <TabLink active={active === "website"}>
        <Link to="/feedback">Website</Link>
      </TabLink>
      <TabLink active={active === "club"}>
        <Link to="/feedback/club">Club</Link>
      </TabLink>
    </div>
  );
}

function TabLink({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="flex-1"
    >
      {children}
    </Button>
  );
}

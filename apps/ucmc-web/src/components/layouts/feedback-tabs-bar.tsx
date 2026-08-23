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
    // A `<nav>` of links, not a tablist of buttons: these are two URLs, so
    // right-click, middle-click, and copy-link all have to keep working.
    // `aria-current` is what conveys the selected one — the styling alone
    // wouldn't.
    <nav
      aria-label="Feedback surface"
      className="inline-flex shrink-0 gap-0.5 rounded-md border bg-muted/40 p-0.5"
    >
      {/* Club first: it goes to the exec board and is the one members are
          more likely to want. */}
      <TabLink to="/feedback/club" active={active === "club"}>
        Club
      </TabLink>
      <TabLink to="/feedback" active={active === "website"}>
        Website
      </TabLink>
    </nav>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: "/feedback" | "/feedback/club";
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      // Sized to sit on the heading's baseline rather than as a full-width
      // bar: two options don't need the width, and at h-7 the control reads
      // as a view switch instead of primary page navigation.
      className={[
        "inline-flex h-7 items-center rounded px-2.5 text-xs font-medium transition-colors",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

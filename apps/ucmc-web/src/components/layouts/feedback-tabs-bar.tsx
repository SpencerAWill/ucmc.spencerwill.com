/**
 * Tab bar rendered by the `/feedback/_tabs` pathless layout. Bridges the
 * `features/feedback` (site) and `features/club-feedback` (governance)
 * surfaces — lives outside both features so neither has to cross-import
 * the other.
 *
 * Per-tab visibility composes the same two gates every other nav surface
 * does — `permission && flags.pages.<key>` — so a tab never links to a
 * page that would 404. Note which flag: the `pages.*` kill switch decides
 * *reachability*, while the `features.*` submission switches
 * (`features.feedback_website_enabled` / `features.feedback_club_enabled`)
 * only pause new submissions and deliberately do NOT hide the tab, because
 * a manager still needs the triage view of existing rows. A plain
 * submitter hitting a paused surface is refused server-side by the action.
 *
 * If a viewer has neither feedback nor club-feedback access, this
 * component returns `null` (the layout will have already redirected
 * them away — this is defense in depth).
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuth } from "#/features/auth/api/use-auth";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export type FeedbackTabId = "site" | "club";

export function activeFeedbackTabFromPath(pathname: string): FeedbackTabId {
  // `/feedback` itself redirects, so only the two surface paths reach here.
  // Club is the fallback because it's the default surface.
  if (pathname.startsWith("/feedback/site")) return "site";
  return "club";
}

const TAB_SUBTITLES: Record<FeedbackTabId, string> = {
  site: "Found a bug, have an idea for the site, or want to share something about how it works? Send it here.",
  club: "Have a suggestion, concern, or kudos for the exec board? This goes directly to club leadership — not website maintainers.",
};

export function getFeedbackTabSubtitle(pathname: string): string {
  return TAB_SUBTITLES[activeFeedbackTabFromPath(pathname)];
}

export function FeedbackTabsBar() {
  const { hasPermission } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;

  const canSeeSite =
    (hasPermission("feedback:submit") || hasPermission("feedback:manage")) &&
    pages.feedback_site;
  const canSeeClub =
    (hasPermission("club_feedback:submit") ||
      hasPermission("club_feedback:manage")) &&
    pages.feedback_club;

  // If the viewer only has access to one tab the bar is just noise.
  if (!(canSeeSite && canSeeClub)) {
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
      <TabLink to="/feedback/site" active={active === "site"}>
        Site
      </TabLink>
    </nav>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: "/feedback/site" | "/feedback/club";
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

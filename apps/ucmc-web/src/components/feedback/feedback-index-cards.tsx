/**
 * The two cards on the `/feedback` index, from plain props. The route
 * computes the props (reachability from page flags plus permissions, manage
 * from `hasPermission`, counts from the overview queries); keeping this
 * component free of hooks is what lets a test pin the one rule that matters:
 * the manager badge and the Review link follow the `canManage*` boolean, never
 * the mere presence of a count in the overview payload. Under role emulation
 * the server still answers the real principal, so a manager previewing as a
 * member receives a count the viewer must not see.
 */
import { MessageSquare, Wrench } from "lucide-react";

import { FeedbackSurfaceCard } from "#/components/feedback/feedback-surface-card";

export interface FeedbackIndexCardsProps {
  clubReachable: boolean;
  siteReachable: boolean;
  canManageClub: boolean;
  canManageSite: boolean;
  /** `null` while loading or when the viewer can't read the overview. */
  club: { mineOpen: number; newForOfficers: number | null } | null;
  site: {
    mineOpen: number;
    mineTracked: number;
    untriaged: number | null;
  } | null;
}

function badge(n: number | null | undefined, suffix: string): string[] {
  return n !== null && n !== undefined && n > 0 ? [`${n} ${suffix}`] : [];
}

export function FeedbackIndexCards({
  clubReachable,
  siteReachable,
  canManageClub,
  canManageSite,
  club,
  site,
}: FeedbackIndexCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {clubReachable ? (
        <FeedbackSurfaceCard
          icon={MessageSquare}
          title="Club feedback"
          description="Reaches the exec board. Suggestions, concerns, praise about trips, meetings, gear, anything club. Can be anonymous."
          to="/feedback/club"
          cta="Give club feedback"
          badges={[
            ...badge(club?.mineOpen, "of yours open"),
            ...(canManageClub
              ? badge(club?.newForOfficers, "new for officers")
              : []),
          ]}
          manageLink={
            canManageClub
              ? { to: "/feedback/club", label: "Review" }
              : undefined
          }
        />
      ) : null}
      {siteReachable ? (
        <FeedbackSurfaceCard
          icon={Wrench}
          title="Site feedback"
          description="Reaches the site maintainers. Bugs, feature ideas, anything about this website."
          to="/feedback/site"
          cta="Report a site issue"
          badges={[
            ...badge(site?.mineOpen, "of yours open"),
            ...badge(site?.mineTracked, "of yours tracked"),
            ...(canManageSite ? badge(site?.untriaged, "untriaged") : []),
          ]}
        />
      ) : null}
    </div>
  );
}

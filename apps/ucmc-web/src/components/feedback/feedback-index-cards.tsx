/**
 * The two cards on the managers' `/feedback` index, from plain props. The
 * route computes reachability (the surface's page flag AND its manage
 * permission, preview-aware) and the counts from the overview queries.
 * A card only renders for a reachable surface, so a count in the payload
 * never shows on its own: under role emulation the server still answers
 * the real principal, and a manager previewing as a member would
 * otherwise see it.
 */
import { MessageSquare, Wrench } from "lucide-react";

import { FeedbackSurfaceCard } from "#/components/feedback/feedback-surface-card";

export interface FeedbackIndexCardsProps {
  clubReachable: boolean;
  siteReachable: boolean;
  /** `null` while loading. */
  club: { newForOfficers: number | null } | null;
  site: { untriaged: number | null } | null;
}

function badge(n: number | null | undefined, suffix: string): string[] {
  return n !== null && n !== undefined && n > 0 ? [`${n} ${suffix}`] : [];
}

export function FeedbackIndexCards({
  clubReachable,
  siteReachable,
  club,
  site,
}: FeedbackIndexCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {clubReachable ? (
        <FeedbackSurfaceCard
          icon={MessageSquare}
          title="Club feedback"
          description="Sent to the exec board. Suggestions, concerns, praise about trips, meetings, gear, anything club. Some is anonymous."
          to="/feedback/club"
          cta="Review"
          badges={badge(club?.newForOfficers, "new for officers")}
        />
      ) : null}
      {siteReachable ? (
        <FeedbackSurfaceCard
          icon={Wrench}
          title="Site feedback"
          description="Sent to the site maintainers. Bugs, feature ideas, anything about this website."
          to="/feedback/site/triage"
          cta="Triage"
          badges={badge(site?.untriaged, "untriaged")}
        />
      ) : null}
    </div>
  );
}

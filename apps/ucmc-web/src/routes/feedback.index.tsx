import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { FeedbackIndexCards } from "#/components/feedback/feedback-index-cards";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import { clubFeedbackOverviewQueryOptions } from "#/features/club-feedback/api/queries";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import { siteFeedbackOverviewQueryOptions } from "#/features/site-feedback/api/queries";

/**
 * `/feedback` — the managers' index: one card per surface the viewer
 * manages whose page is on (club first, since it reaches the exec board).
 * The layout has already sent non-managers to `/my/feedback`; this 404s
 * when every managed surface's page is switched off.
 */
export const Route = createFileRoute("/feedback/")({
  beforeLoad: async ({ context, location }) => {
    const principal = await requireApproved({ context, location });
    const flags = await context.queryClient.ensureQueryData(
      publicFlagsQueryOptions(),
    );
    // Effective (preview-aware) permissions, so a role preview 404s exactly
    // where the sidebar entry has already disappeared.
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    const canClub =
      flags.pages.feedback_club && granted.includes("club_feedback:manage");
    const canSite =
      flags.pages.feedback_site && granted.includes("site_feedback:manage");
    if (!canClub && !canSite) {
      throw notFound();
    }
  },
  component: FeedbackIndexPage,
});

function FeedbackIndexPage() {
  const { hasPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);

  // `hasPermission` honours role emulation; the overview payload does not
  // (the server answers the real principal), so the cards follow this and
  // never the presence of a count.
  const clubReachable =
    flags.pages.feedback_club && hasPermission("club_feedback:manage");
  const siteReachable =
    flags.pages.feedback_site && hasPermission("site_feedback:manage");

  const clubOverview = useQuery({
    ...clubFeedbackOverviewQueryOptions(),
    enabled: clubReachable,
  });
  const siteOverview = useQuery({
    ...siteFeedbackOverviewQueryOptions(),
    enabled: siteReachable,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          What members have sent to the exec board and the site maintainers.
        </p>
      </header>
      <FeedbackIndexCards
        clubReachable={clubReachable}
        siteReachable={siteReachable}
        club={clubOverview.data ?? null}
        site={siteOverview.data ?? null}
      />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { FeedbackIndexCards } from "#/components/feedback/feedback-index-cards";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  CLUB_FEEDBACK_PERMISSIONS,
  SITE_FEEDBACK_PERMISSIONS,
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import { clubFeedbackOverviewQueryOptions } from "#/features/club-feedback/api/queries";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import { siteFeedbackOverviewQueryOptions } from "#/features/site-feedback/api/queries";

/**
 * `/feedback` is a page: one card per surface the viewer can reach. It 404s
 * only when neither surface is reachable. Reachability is permission AND
 * `pages.*` flag aware (club first, since it reaches the exec board).
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
      flags.pages.feedback_club &&
      CLUB_FEEDBACK_PERMISSIONS.some((p) => granted.includes(p));
    const canSite =
      flags.pages.feedback_site &&
      SITE_FEEDBACK_PERMISSIONS.some((p) => granted.includes(p));
    if (!canClub && !canSite) {
      throw notFound();
    }
  },
  component: FeedbackIndexPage,
});

function FeedbackIndexPage() {
  const { hasPermission, hasAnyPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);

  const clubReachable =
    flags.pages.feedback_club && hasAnyPermission(CLUB_FEEDBACK_PERMISSIONS);
  const siteReachable =
    flags.pages.feedback_site && hasAnyPermission(SITE_FEEDBACK_PERMISSIONS);
  // `hasPermission` honours role emulation; the overview payload does not
  // (the server answers the real principal), so the badge follows this and
  // never the presence of a count.
  const canManageClub = clubReachable && hasPermission("club_feedback:manage");
  const canManageSite = siteReachable && hasPermission("site_feedback:manage");

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
          Tell the club, or tell the people who run this website.
        </p>
      </header>
      <FeedbackIndexCards
        clubReachable={clubReachable}
        siteReachable={siteReachable}
        canManageClub={canManageClub}
        canManageSite={canManageSite}
        club={clubOverview.data ?? null}
        site={siteOverview.data ?? null}
      />
    </div>
  );
}

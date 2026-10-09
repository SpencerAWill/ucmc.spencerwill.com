import { createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.membership;

/**
 * `/analytics/membership`. `analytics:view` comes from the `/analytics`
 * layout; this leaf adds the gate on the data it actually shows, and
 * 404s rather than redirecting so a viewer without it cannot tell the
 * page apart from one that does not exist.
 */
export const Route = createFileRoute("/analytics/membership")({
  staticData: { pageFlag: "analytics_membership" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics_membership");
    await requireAnyPermissionOrNotFound(
      context.queryClient,
      PAGE.dataPermissions,
    );
  },
  component: AnalyticsMembershipPage,
});

function AnalyticsMembershipPage() {
  return (
    <AnalyticsPage title={PAGE.label} question={PAGE.question}>
      <AnalyticsPanel title="Panels">
        <AnalyticsPanelEmpty>
          Pending until the panels land — the funnel, growth and retention
          reads.
        </AnalyticsPanelEmpty>
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

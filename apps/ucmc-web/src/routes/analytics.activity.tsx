import { createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.activity;

/**
 * `/analytics/activity`. `analytics:view` comes from the `/analytics`
 * layout; this leaf adds the gate on the data it actually shows, and
 * 404s rather than redirecting so a viewer without it cannot tell the
 * page apart from one that does not exist.
 */
export const Route = createFileRoute("/analytics/activity")({
  staticData: { pageFlag: "analytics_activity" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics_activity");
    await requireAnyPermissionOrNotFound(
      context.queryClient,
      PAGE.dataPermissions,
    );
  },
  component: AnalyticsActivityPage,
});

function AnalyticsActivityPage() {
  return (
    <AnalyticsPage title={PAGE.label} question={PAGE.question}>
      <AnalyticsPanel title="Panels">
        <AnalyticsPanelEmpty>
          Pending until the panels land — events by kind, cancellations and
          volunteer service.
        </AnalyticsPanelEmpty>
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

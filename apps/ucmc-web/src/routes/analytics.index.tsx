import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsDoors } from "#/features/analytics/components/analytics-doors";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * The root analytics dashboard: club health in one screen, with the
 * five drill-downs behind it.
 *
 * Carries no `dataPermissions` gate of its own — `analytics:view` from
 * the layout is enough to open it, and every panel on it is
 * individually gated. A viewer holding nothing but `analytics:view`
 * therefore gets a real page that says so, rather than a 404 or a
 * blank.
 */
export const Route = createFileRoute("/analytics/")({
  staticData: { pageFlag: "analytics" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics");
  },
  component: AnalyticsOverviewPage,
});

function AnalyticsOverviewPage() {
  return (
    <AnalyticsPage
      title="Club health"
      question="What needs attention this week?"
    >
      <AnalyticsDoors />
    </AnalyticsPage>
  );
}

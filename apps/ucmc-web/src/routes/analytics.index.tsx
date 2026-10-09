import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { canSeeAnalyticsPage } from "#/config/analytics-pages";
import { AnalyticsDoors } from "#/features/analytics/components/analytics-doors";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import { AnalyticsPanel } from "#/features/analytics/components/analytics-panel";
import { AttentionPanel } from "#/features/analytics/components/attention-panel";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import {
  activityAnalyticsQueryOptions,
  complianceAnalyticsQueryOptions,
  gearAnalyticsQueryOptions,
  membershipAnalyticsQueryOptions,
  platformAnalyticsQueryOptions,
} from "#/features/analytics/api/queries";
import { buildAttention } from "#/features/analytics/lib/attention";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * The root analytics dashboard: club health in one screen.
 *
 * Carries no `dataPermissions` gate of its own — `analytics:view` from
 * the layout opens it, and every panel is individually gated. A viewer
 * holding nothing but `analytics:view` gets a real page that says so.
 *
 * **Every query here is `enabled` on the viewer's own permissions**,
 * because each server action refuses a caller who lacks them. That is
 * the gate working as designed, not something to route around: the
 * client simply does not ask for what it may not have, and the page
 * composes whatever came back. Gates read `hasPermission`, never
 * `principal.permissions`, so a role preview narrows this page the way
 * it narrows everything else.
 *
 * No loader, deliberately — unlike the drill-downs. The set of queries
 * depends on the viewer's permissions, which a loader would have to
 * re-derive server-side before the component ever renders, for a page
 * whose panels each handle their own pending state anyway.
 */
export const Route = createFileRoute("/analytics/")({
  staticData: { pageFlag: "analytics" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics");
  },
  component: AnalyticsOverviewPage,
});

function AnalyticsOverviewPage() {
  const { hasPermission } = useAuth();

  const canGear = canSeeAnalyticsPage(hasPermission, "gear");
  const canCompliance = canSeeAnalyticsPage(hasPermission, "compliance");
  const canPlatform = canSeeAnalyticsPage(hasPermission, "platform");
  const canMembership = canSeeAnalyticsPage(hasPermission, "membership");
  const canActivity = canSeeAnalyticsPage(hasPermission, "activity");

  const gear = useQuery({
    ...gearAnalyticsQueryOptions(null),
    enabled: canGear,
  });
  const compliance = useQuery({
    ...complianceAnalyticsQueryOptions(null),
    enabled: canCompliance,
  });
  const platform = useQuery({
    ...platformAnalyticsQueryOptions(null),
    enabled: canPlatform,
  });
  const membership = useQuery({
    ...membershipAnalyticsQueryOptions(null),
    enabled: canMembership,
  });
  const activity = useQuery({
    ...activityAnalyticsQueryOptions(null),
    enabled: canActivity,
  });

  const attention = useMemo(
    () =>
      buildAttention({
        gear: gear.data,
        compliance: compliance.data,
        platform: platform.data,
        membership: membership.data,
      }),
    [gear.data, compliance.data, platform.data, membership.data],
  );

  const anyVisible =
    canGear || canCompliance || canPlatform || canMembership || canActivity;
  const season =
    membership.data?.season ??
    compliance.data?.season ??
    gear.data?.season ??
    activity.data?.season ??
    platform.data?.season ??
    null;

  return (
    <AnalyticsPage
      title="Club health"
      question="What needs attention this week?"
      controls={
        season ? (
          <span className="text-sm text-muted-foreground">Season {season}</span>
        ) : null
      }
    >
      {anyVisible ? (
        <StatTileRow>
          {membership.data ? (
            <StatTile
              label="Approved members"
              value={String(membership.data.approved)}
              meta={`${membership.data.joinedThisSeason} joined this season.`}
            />
          ) : null}
          {activity.data ? (
            <StatTile
              label="Events held"
              value={String(activity.data.eventsHeld)}
              meta={`${activity.data.serviceHours} volunteer service hours this season.`}
            />
          ) : null}
          {gear.data ? (
            <StatTile
              label="Gear out now"
              value={String(gear.data.outNow)}
              tone={gear.data.overdueNow > 0 ? "warn" : "neutral"}
              meta={
                gear.data.overdueNow === 0
                  ? "Nothing overdue."
                  : `${gear.data.overdueNow} overdue.`
              }
            />
          ) : null}
          {compliance.data ? (
            <StatTile
              label="Waiver coverage"
              value={`${compliance.data.waivers.covered} / ${compliance.data.waivers.approved}`}
              tone={compliance.data.waivers.uncovered > 0 ? "warn" : "neutral"}
              meta={
                compliance.data.waivers.uncovered === 0
                  ? "Every approved member is covered."
                  : `${compliance.data.waivers.uncovered} still owe a signed waiver.`
              }
            />
          ) : null}
        </StatTileRow>
      ) : null}

      <AnalyticsPanel
        title="Needs attention"
        note="Sorted by consequence, not by count"
      >
        <AttentionPanel items={attention} anyVisible={anyVisible} />
      </AnalyticsPanel>

      <AnalyticsDoors />
    </AnalyticsPage>
  );
}

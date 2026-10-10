import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { visibleAnalyticsPages } from "#/config/analytics-pages";
import type { AnalyticsPageKey } from "#/config/analytics-pages";
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
import {
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * How the loader warms each page's dataset.
 *
 * Each entry is its own closure rather than a bare options factory
 * indexed by key: `Record<K, Options<T_K>>` loses the key-to-type
 * correlation the moment it is indexed by a `K` union, and TypeScript
 * then tries to satisfy every options type with every result type.
 * Wrapping the `ensureQueryData` call keeps each entry monomorphic, so
 * this stays type-checked instead of needing a cast.
 *
 * Typed `Record<AnalyticsPageKey, …>` so a new page in the registry
 * fails the typecheck here until it declares how to warm itself.
 */
const WARM_QUERY: Record<
  AnalyticsPageKey,
  (queryClient: QueryClient) => Promise<unknown>
> = {
  membership: (qc) => qc.ensureQueryData(membershipAnalyticsQueryOptions(null)),
  gear: (qc) => qc.ensureQueryData(gearAnalyticsQueryOptions(null)),
  activity: (qc) => qc.ensureQueryData(activityAnalyticsQueryOptions(null)),
  compliance: (qc) => qc.ensureQueryData(complianceAnalyticsQueryOptions(null)),
  platform: (qc) => qc.ensureQueryData(platformAnalyticsQueryOptions(null)),
};

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
 * composes whatever came back. Gates read `hasPermission` /
 * `effectivePermissionsFor`, never `principal.permissions`, so a role
 * preview narrows this page the way it narrows everything else.
 *
 * The loader resolves the same permitted set server-side and warms
 * exactly those queries. **That is not an optimisation.** Without it
 * the exception list renders empty during SSR, which is
 * indistinguishable from "nothing is wrong" — an officer would get a
 * flash of all-clear before the real items arrive. `AttentionPanel`
 * carries a pending state for the client-navigation case; this is what
 * keeps the first paint honest.
 *
 * `Promise.allSettled`, not `all`: one failing dataset must degrade to
 * a page missing that panel, not to a route-level error that hides the
 * other four. The component re-reads each query and renders what
 * resolved.
 */
export const Route = createFileRoute("/analytics/")({
  staticData: { pageFlag: "analytics" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics");
    // The parent layout already ran `requirePermission`, so this is a
    // cached read rather than a second gate — it exists to get the
    // principal into scope for the permission resolution below.
    const principal = await requireApproved(context.queryClient);
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    return { granted };
  },
  loader: async ({ context }) => {
    const has = (permission: string) => context.granted.includes(permission);
    // `visibleAnalyticsPages`, not `canSeeAnalyticsPage`: the latter
    // answers permissions only, and warming a page whose `pages.*`
    // switch is off would surface a tile and an attention row linking
    // straight to a 404. Same resolution the sidebar, doors and
    // sub-nav use, which is the whole reason the registry exists.
    const flags = await context.queryClient.ensureQueryData(
      publicFlagsQueryOptions(),
    );
    await Promise.allSettled(
      visibleAnalyticsPages(has, flags.pages).map((key) =>
        WARM_QUERY[key](context.queryClient),
      ),
    );
  },
  component: AnalyticsOverviewPage,
});

function AnalyticsOverviewPage() {
  const { hasPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);

  // Permissions AND the per-page kill switch, so a panel can never
  // outlive the page it links to.
  const visible = new Set(visibleAnalyticsPages(hasPermission, flags.pages));
  const canGear = visible.has("gear");
  const canCompliance = visible.has("compliance");
  const canPlatform = visible.has("platform");
  const canMembership = visible.has("membership");
  const canActivity = visible.has("activity");

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

  const datasets = [
    { label: "Gear", query: gear, enabled: canGear },
    { label: "Compliance", query: compliance, enabled: canCompliance },
    { label: "Platform", query: platform, enabled: canPlatform },
    { label: "Membership", query: membership, enabled: canMembership },
    { label: "Activity", query: activity, enabled: canActivity },
  ];

  // Pending only counts queries this viewer is actually running — a
  // disabled query sits in `pending` forever and would otherwise hold
  // the panel on "Checking…" permanently for a partially-granted role.
  const isPending = datasets.some(
    (d) => d.enabled && d.query.isFetching && d.query.data === undefined,
  );
  // **A failed query must not read as an invisible one.** `buildAttention`
  // treats `undefined` as "this viewer cannot see that dataset", and a
  // rejected query leaves `data` undefined with `isFetching` false — so
  // without this the panel says "nothing needs attention in the data you
  // can see" while gear actually has three loans 22 days overdue. That is
  // the same false reassurance `isPending` was added to remove, left open
  // on the error branch.
  const failedLabels = datasets
    .filter((d) => d.enabled && d.query.isError)
    .map((d) => d.label);
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
        <AttentionPanel
          items={attention}
          anyVisible={anyVisible}
          isPending={isPending}
          failedLabels={failedLabels}
        />
      </AnalyticsPanel>

      <AnalyticsDoors />
    </AnalyticsPage>
  );
}

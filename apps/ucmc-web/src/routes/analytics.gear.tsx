import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { RankedBars } from "#/features/analytics/components/ranked-bars";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import { gearAnalyticsQueryOptions } from "#/features/analytics/api/queries";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.gear;

/**
 * `/analytics/gear`. Utilisation, overdue aging, loan duration and
 * inspection standing — all from columns that exist today.
 */
export const Route = createFileRoute("/analytics/gear")({
  staticData: { pageFlag: "analytics_gear" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics_gear");
    await requireAnyPermissionOrNotFound(
      context.queryClient,
      PAGE.dataPermissions,
    );
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(gearAnalyticsQueryOptions(null)),
  component: AnalyticsGearPage,
});

function AnalyticsGearPage() {
  const query = useQuery(gearAnalyticsQueryOptions(null));
  const data = query.data;

  if (!data) {
    return (
      <AnalyticsPage title={PAGE.label} question={PAGE.question}>
        <AnalyticsPanel title="Gear">
          <AnalyticsPanelEmpty>
            {query.isError
              ? "Couldn’t load the gear figures. Reload the page to try again."
              : "Loading…"}
          </AnalyticsPanelEmpty>
        </AnalyticsPanel>
      </AnalyticsPage>
    );
  }

  const utilisation =
    data.activeItems === 0 ? null : (data.outNow / data.activeItems) * 100;

  return (
    <AnalyticsPage
      title={PAGE.label}
      question={PAGE.question}
      controls={
        <span className="text-sm text-muted-foreground">
          Season {data.season}
        </span>
      }
    >
      <StatTileRow>
        <StatTile
          label="Out now"
          value={String(data.outNow)}
          meta={
            utilisation === null
              ? "No active items in the inventory yet."
              : `${utilisation.toFixed(0)}% of ${data.activeItems} active items. Point-in-time, not a season figure.`
          }
        />
        <StatTile
          label="Overdue now"
          value={String(data.overdueNow)}
          tone={data.overdueNow > 0 ? "warn" : "neutral"}
          meta="Open loans past their due date, banded below by how late."
        />
        <StatTile
          label="Median loan"
          value={
            data.medianLoanDays === null
              ? "—"
              : `${data.medianLoanDays.toFixed(1)}d`
          }
          meta={
            data.medianLoanDays === null
              ? "No loans closed this season yet."
              : "Across loans closed this season. Median, so one forgotten rope does not move it."
          }
        />
      </StatTileRow>

      <AnalyticsPanel
        title="Overdue aging"
        note="The same bands the reminder ladder uses"
      >
        {data.overdueNow === 0 ? (
          <AnalyticsPanelEmpty>
            Nothing is overdue. Every open loan is inside its due date.
          </AnalyticsPanelEmpty>
        ) : (
          <>
            <RankedBars
              rows={data.overdueBands.map((band) => ({
                key: band.key,
                label: band.label,
                value: band.loans,
              }))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              These are the rungs the reminder job already climbs, so a loan in
              a band here has had exactly that many reminders.
            </p>
          </>
        )}
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Most borrowed"
        note="By loan count this season, not by units"
      >
        {data.mostBorrowed.length === 0 ? (
          <AnalyticsPanelEmpty>
            No gear checked out this season yet.
          </AnalyticsPanelEmpty>
        ) : (
          <RankedBars
            rows={data.mostBorrowed.map((row) => ({
              key: `${row.manufacturer ?? ""} ${row.model}`,
              label: row.model,
              sublabel: row.manufacturer,
              value: row.loans,
            }))}
          />
        )}
      </AnalyticsPanel>

      <AnalyticsPanel title="Inventory health" note="Across active items">
        <ul className="divide-y text-sm">
          <li className="flex items-baseline justify-between py-2">
            <span>Loans opened this season</span>
            <span className="font-medium tabular-nums">
              {data.loansThisSeason}
            </span>
          </li>
          <li className="flex items-baseline justify-between py-2">
            <span>
              Never borrowed this season
              <span className="ml-2 text-xs text-muted-foreground">
                the budget question
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {data.neverBorrowed}
            </span>
          </li>
          <li className="flex items-baseline justify-between py-2">
            <span>
              Latest inspection failed
              <span className="ml-2 text-xs text-muted-foreground">
                known bad
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {data.failedInspections}
            </span>
          </li>
          <li className="flex items-baseline justify-between py-2">
            <span>
              Never inspected
              <span className="ml-2 text-xs text-muted-foreground">
                unknown, not bad
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {data.uninspectedItems}
            </span>
          </li>
          <li className="flex items-baseline justify-between py-2">
            <span>Units written off as lost</span>
            <span className="font-medium tabular-nums">{data.unitsLost}</span>
          </li>
        </ul>
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

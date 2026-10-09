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
  SEASON_MONTH_LABELS,
  SeasonAxisChart,
} from "#/features/analytics/components/season-axis-chart";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { activityAnalyticsQueryOptions } from "#/features/analytics/api/queries";
import { cancellationRate, formatShare } from "#/features/analytics/lib/rates";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.activity;

/**
 * `/analytics/activity`. What the club did, on the season axis.
 *
 * The page is explicit about the one thing it cannot answer:
 * attendance. `events` records what was scheduled, so the trip count
 * is honest and the participation count does not exist yet.
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
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(activityAnalyticsQueryOptions(null)),
  component: AnalyticsActivityPage,
});

function AnalyticsActivityPage() {
  const query = useQuery(activityAnalyticsQueryOptions(null));
  const data = query.data;

  if (!data) {
    return (
      <AnalyticsPage title={PAGE.label} question={PAGE.question}>
        <AnalyticsPanel title="Activity">
          <AnalyticsPanelEmpty>
            {query.isError
              ? "Couldn’t load the activity figures. Reload the page to try again."
              : "Loading…"}
          </AnalyticsPanelEmpty>
        </AnalyticsPanel>
      </AnalyticsPage>
    );
  }

  const scheduled = data.eventsHeld + data.eventsCanceled;
  const cancelShare = cancellationRate(data.eventsHeld, data.eventsCanceled);

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
          label="Events held"
          value={String(data.eventsHeld)}
          meta={`Of ${scheduled} scheduled. Held means not cancelled — it does not mean anyone came.`}
        />
        <StatTile
          label="Cancellation rate"
          value={formatShare(cancelShare)}
          tone={
            cancelShare !== null && cancelShare >= 0.25 ? "warn" : "neutral"
          }
          meta={
            cancelShare === null
              ? "Nothing scheduled this season, so there is no rate to report."
              : `${data.eventsCanceled} cancelled of ${scheduled}.`
          }
        />
        <StatTile
          label="Service hours"
          value={String(data.serviceHours)}
          meta={`Across ${data.volunteerOutings} volunteer ${data.volunteerOutings === 1 ? "outing" : "outings"} this season.`}
        />
      </StatTileRow>

      <AnalyticsPanel
        title="Events by month"
        note="August to July — the season axis, not the calendar year"
      >
        {data.eventsHeld === 0 ? (
          <AnalyticsPanelEmpty>
            No events held this season yet.
          </AnalyticsPanelEmpty>
        ) : (
          <SeasonAxisChart
            points={data.byMonth.map((row) => ({
              monthIndex: row.monthIndex,
              series: row.kind,
              value: row.events,
            }))}
            valueLabel="Events"
            ariaLabel={`Events held each month of season ${data.season}, stacked by kind`}
            ariaDescription="The axis runs August to July, the club season, so a season is never split across two calendar years. Months with no events keep their slot."
            table={<EventsByMonthTable rows={data.byMonth} />}
          />
        )}
      </AnalyticsPanel>

      <AnalyticsPanel title="By kind" note="Events held this season">
        {data.byKind.length === 0 ? (
          <AnalyticsPanelEmpty>
            No events held this season yet.
          </AnalyticsPanelEmpty>
        ) : (
          <RankedBars
            rows={data.byKind.map((row) => ({
              key: row.kind,
              label: row.kind,
              value: row.events,
            }))}
          />
        )}
      </AnalyticsPanel>

      <AnalyticsPanel
        title="By semester"
        note="Per month, because the three periods are unequal"
      >
        <ul className="divide-y text-sm">
          {data.bySemester.map((row) => (
            <li key={row.semester} className="py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{row.label}</span>
                <span className="tabular-nums">
                  {row.events}
                  <span className="ml-2 text-muted-foreground">
                    {row.perMonth.toFixed(1)}/month
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {row.serviceHours} service hours · {row.volunteers} volunteers
              </p>
            </li>
          ))}
        </ul>
      </AnalyticsPanel>

      <AnalyticsPanel title="Reach" note="Point-in-time, not a season figure">
        <ul className="divide-y text-sm">
          <li className="flex items-baseline justify-between py-2">
            <span>Live calendar subscriptions</span>
            <span className="font-medium tabular-nums">
              {data.calendarSubscriptions}
            </span>
          </li>
          <li className="flex items-baseline justify-between py-2">
            <span>
              Album photos taken this season
              <span className="ml-2 text-xs text-muted-foreground">
                evidence of trips run
              </span>
            </span>
            <span className="font-medium tabular-nums">{data.photosAdded}</span>
          </li>
        </ul>
      </AnalyticsPanel>

      <AnalyticsPanel title="What this page cannot tell you">
        <p className="text-sm text-muted-foreground">
          Every figure above counts what was <b>scheduled</b> and not cancelled.
          Nothing records who turned up, so “14 trips ran” is honest and “41
          members went on a trip” is not answerable yet. Trip signups with a
          lottery roster and a post-trip confirmation are what create that
          record; until then, treat attendance as unmeasured rather than zero.
        </p>
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

/** Exact values behind the season chart, per the accessibility guide. */
function EventsByMonthTable({
  rows,
}: {
  rows: { monthIndex: number; kind: string; events: number }[];
}) {
  const kinds = [...new Set(rows.map((row) => row.kind))].sort();
  const byKey = new Map(
    rows.map((row) => [`${row.monthIndex} ${row.kind}`, row.events]),
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          {kinds.map((kind) => (
            <TableHead key={kind} className="text-right">
              {kind}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {SEASON_MONTH_LABELS.map((label, monthIndex) => (
          <TableRow key={label}>
            <TableCell className="font-medium">{label}</TableCell>
            {kinds.map((kind) => (
              <TableCell key={kind} className="text-right tabular-nums">
                {byKey.get(`${monthIndex} ${kind}`) ?? 0}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

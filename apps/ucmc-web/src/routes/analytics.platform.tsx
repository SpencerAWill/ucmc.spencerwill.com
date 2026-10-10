import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { EmailVolumeTable } from "#/features/analytics/components/email-volume-table";
import { HeadroomMeters } from "#/features/analytics/components/headroom-meters";
import { SnapshotTable } from "#/features/analytics/components/snapshot-table";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import { UsageSparklines } from "#/features/analytics/components/usage-sparklines";
import { platformAnalyticsQueryOptions } from "#/features/analytics/api/queries";
import {
  formatCents,
  formatHeadroom,
  headroomSeverity,
} from "#/features/analytics/lib/headroom";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.platform;

/**
 * `/analytics/platform`. `analytics:view` comes from the `/analytics`
 * layout; this leaf adds the gate on the data it actually shows, and
 * 404s rather than redirecting so a viewer without it cannot tell the
 * page apart from one that does not exist.
 *
 * The one drill-down whose data already exists — `cost_snapshots` from
 * issue #268. Headroom leads and cost follows, because the club is
 * inside every free tier and a stacked bar of zeros teaches nothing
 * while "which service runs out first" has a real answer.
 */
export const Route = createFileRoute("/analytics/platform")({
  staticData: { pageFlag: "analytics_platform" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics_platform");
    await requireAnyPermissionOrNotFound(
      context.queryClient,
      PAGE.dataPermissions,
    );
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(platformAnalyticsQueryOptions(null)),
  component: AnalyticsPlatformPage,
});

function AnalyticsPlatformPage() {
  const query = useQuery(platformAnalyticsQueryOptions(null));
  const data = query.data;

  if (!data) {
    return (
      <AnalyticsPage title={PAGE.label} question={PAGE.question}>
        <AnalyticsPanel title="Platform">
          <AnalyticsPanelEmpty>
            {query.isError
              ? "Couldn’t load the platform snapshot. Reload the page to try again."
              : "Loading…"}
          </AnalyticsPanelEmpty>
        </AnalyticsPanel>
      </AnalyticsPage>
    );
  }

  // Worst-first from the server, so the head of the list IS the
  // tightest ceiling — no second sort, and no chance of the tile and
  // the meter list disagreeing about which service that is.
  const tightest = data.headroom.find((s) => s.fraction !== null);
  const tightestFraction = tightest?.fraction ?? null;

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
          label="Cost this season"
          value={formatCents(data.totalCostCents)}
          meta={
            data.totalCostCents === 0
              ? "Every service inside its free tier. Recorded anyway, so the first non-zero month has a baseline."
              : `Across ${data.costByMonth.length} billed service-months.`
          }
        />
        <StatTile
          label="Tightest headroom"
          value={
            tightestFraction === null ? "—" : formatHeadroom(tightestFraction)
          }
          tone={
            tightestFraction === null
              ? "neutral"
              : headroomSeverity(tightestFraction) === "at-risk"
                ? "crit"
                : headroomSeverity(tightestFraction) === "watch"
                  ? "warn"
                  : "neutral"
          }
          meta={
            tightest ? (
              <>
                <b className="font-medium text-foreground">{tightest.label}</b>{" "}
                — peak on {tightest.peakDay}. Nearest cap of any service.
              </>
            ) : (
              "No service with a tracked limit reported usage this season."
            )
          }
        />
        <StatTile
          label="Services tracked"
          value={String(data.headroom.length)}
          meta={`Reporting between ${data.windowStart} and today. Limits are hand-entered — see the service catalog.`}
        />
      </StatTileRow>

      <AnalyticsPanel
        title="Free-tier headroom"
        note="Peak period in range against each service’s own cap"
      >
        {data.headroom.length === 0 ? (
          <AnalyticsPanelEmpty>
            No usage recorded for season {data.season} yet. The daily cron
            writes these rows; nothing is missing if the season has only just
            opened.
          </AnalyticsPanelEmpty>
        ) : (
          <HeadroomMeters services={data.headroom} />
        )}
      </AnalyticsPanel>

      {data.headroom.length > 0 ? (
        <AnalyticsPanel
          title="Daily usage, as a share of cap"
          note="Shared 0–100% axis — one scale, so panels compare"
        >
          <UsageSparklines services={data.headroom} />
        </AnalyticsPanel>
      ) : null}

      <AnalyticsPanel
        title="Cost by service family"
        note="Billed amounts only — not the club’s wider costs"
      >
        {data.totalCostCents === 0 ? (
          <AnalyticsPanelEmpty>
            {data.noSnapshots
              ? "No snapshots recorded for this season yet."
              : "No billable usage in any month on record. The rows are captured either way, so this fills in the day a figure moves."}
          </AnalyticsPanelEmpty>
        ) : (
          <ul className="divide-y text-sm">
            {data.costByMonth.map((row) => (
              <li
                key={`${row.month} ${row.family}`}
                className="flex justify-between py-2 tabular-nums"
              >
                <span>
                  {row.month} · {row.family}
                </span>
                <span className="font-medium">{formatCents(row.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Email volume by notification"
        note="Delivered and rejected, this season"
      >
        {data.emails.length === 0 ? (
          <AnalyticsPanelEmpty>No email sent this season.</AnalyticsPanelEmpty>
        ) : (
          <EmailVolumeTable emails={data.emails} />
        )}
      </AnalyticsPanel>

      {data.headroom.length > 0 ? (
        <AnalyticsPanel
          title="Latest snapshot"
          note="The table view every panel above is also readable as"
        >
          <SnapshotTable services={data.headroom} />
        </AnalyticsPanel>
      ) : null}
    </AnalyticsPage>
  );
}

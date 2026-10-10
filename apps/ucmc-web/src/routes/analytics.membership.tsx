import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { RankedBars } from "#/features/analytics/components/ranked-bars";
import { SEASON_MONTH_LABELS } from "#/features/analytics/components/season-axis-chart";
import { SeasonOverlayChart } from "#/features/analytics/components/season-overlay-chart";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import { membershipAnalyticsQueryOptions } from "#/features/analytics/api/queries";
import { formatShare, shareOf } from "#/features/analytics/lib/rates";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.membership;

/**
 * `/analytics/membership`. Growth, the status funnel, retention and
 * tenure — from timestamps `users` already carries.
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
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(membershipAnalyticsQueryOptions(null)),
  component: AnalyticsMembershipPage,
});

function AnalyticsMembershipPage() {
  const query = useQuery(membershipAnalyticsQueryOptions(null));
  const data = query.data;

  if (!data) {
    return (
      <AnalyticsPage title={PAGE.label} question={PAGE.question}>
        <AnalyticsPanel title="Membership">
          <AnalyticsPanelEmpty>
            {query.isError
              ? "Couldn’t load the membership figures. Reload the page to try again."
              : "Loading…"}
          </AnalyticsPanelEmpty>
        </AnalyticsPanel>
      </AnalyticsPage>
    );
  }

  const retentionShare = shareOf(data.returning, data.returningFrom);
  const anyJoins = data.joinsByMonth.some((row) => row.joined > 0);

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
          label="Approved members"
          value={String(data.approved)}
          meta="Accounts an officer has approved and not deactivated."
        />
        <StatTile
          label="Joined this season"
          value={String(data.joinedThisSeason)}
          meta={`Registrations opened since the season began. Officer pre-adds are excluded — they are bookkeeping, not arrivals.`}
        />
        <StatTile
          label="Came back"
          value={
            data.returningFrom === 0
              ? "—"
              : `${data.returning} / ${data.returningFrom}`
          }
          meta={
            data.returningFrom === 0
              ? `Nobody attested in ${data.previousSeason}, so there is no cohort to follow.`
              : `${formatShare(retentionShare)} of the members who signed in ${data.previousSeason} signed again.`
          }
        />
      </StatTileRow>

      <AnalyticsPanel
        title="New members by month"
        note={`${data.season} against ${data.previousSeason}`}
      >
        {anyJoins ? (
          <SeasonOverlayChart
            points={data.joinsByMonth.map((row) => ({
              season: row.season,
              monthIndex: row.monthIndex,
              value: row.joined,
            }))}
            valueLabel="New members"
            ariaLabel={`New members each month, season ${data.season} against ${data.previousSeason}`}
            ariaDescription="Both lines are indexed to their own season's August, so the same month of two seasons sits at the same horizontal position. The current season stops at the present month rather than dropping to zero."
            table={<JoinsTable rows={data.joinsByMonth} />}
          />
        ) : (
          <AnalyticsPanelEmpty>
            No registrations in either season yet.
          </AnalyticsPanelEmpty>
        )}
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Roster by status"
        note="All accounts, not just this season"
      >
        <RankedBars
          rows={data.funnel.map((row) => ({
            key: row.status,
            label: row.status,
            value: row.members,
          }))}
        />
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Tenure"
        note="Distinct seasons a member has signed a waiver in"
      >
        <RankedBars
          rows={data.tenure.map((band) => ({
            key: band.label,
            label: band.label,
            value: band.members,
          }))}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Attestation cycles are the only continuous per-season signal the
          database holds, so tenure and retention both undercount a member who
          stayed involved without signing. Read them as a floor.
        </p>
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Role coverage"
        note={
          data.vacantRoles === 0
            ? "Every seat filled"
            : `${data.vacantRoles} vacant`
        }
      >
        <RankedBars
          rows={data.roles.map((row) => ({
            key: row.role,
            label: row.displayName,
            value: row.holders,
          }))}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          A role with nobody in it is usually a handover that did not finish.
          The member and anonymous roles are excluded — the first follows
          account status and the second has no members by construction.
        </p>
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

/** Exact values behind the overlay, per the accessibility guide. */
function JoinsTable({
  rows,
}: {
  rows: { season: string; monthIndex: number; joined: number }[];
}) {
  const seasons = [...new Set(rows.map((row) => row.season))].sort();
  const byKey = new Map(
    rows.map((row) => [`${row.season} ${row.monthIndex}`, row.joined]),
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          {seasons.map((season) => (
            <TableHead key={season} className="text-right">
              {season}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {SEASON_MONTH_LABELS.map((label, monthIndex) => (
          <TableRow key={label}>
            <TableCell className="font-medium">{label}</TableCell>
            {seasons.map((season) => (
              <TableCell key={season} className="text-right tabular-nums">
                {byKey.get(`${season} ${monthIndex}`) ?? 0}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

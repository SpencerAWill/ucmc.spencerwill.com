import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_PAGES } from "#/config/analytics-pages";
import { AnalyticsPage } from "#/features/analytics/components/analytics-page";
import {
  AnalyticsPanel,
  AnalyticsPanelEmpty,
} from "#/features/analytics/components/analytics-panel";
import { CoverageBar } from "#/features/analytics/components/coverage-bar";
import {
  StatTile,
  StatTileRow,
} from "#/features/analytics/components/stat-tile";
import { complianceAnalyticsQueryOptions } from "#/features/analytics/api/queries";
import { requireAnyPermissionOrNotFound } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

const PAGE = ANALYTICS_PAGES.compliance;

/**
 * `/analytics/compliance`. The obligations with consequences behind
 * them — waiver coverage above all, which is the most officer-
 * actionable number in the whole area.
 *
 * Gated on the waiver-view pair rather than a generic analytics
 * permission: this page reports who may legally participate.
 */
export const Route = createFileRoute("/analytics/compliance")({
  staticData: { pageFlag: "analytics_compliance" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "analytics_compliance");
    await requireAnyPermissionOrNotFound(
      context.queryClient,
      PAGE.dataPermissions,
    );
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(complianceAnalyticsQueryOptions(null)),
  component: AnalyticsCompliancePage,
});

function AnalyticsCompliancePage() {
  const query = useQuery(complianceAnalyticsQueryOptions(null));
  const data = query.data;

  if (!data) {
    return (
      <AnalyticsPage title={PAGE.label} question={PAGE.question}>
        <AnalyticsPanel title="Compliance">
          <AnalyticsPanelEmpty>
            {query.isError
              ? "Couldn’t load the compliance figures. Reload the page to try again."
              : "Loading…"}
          </AnalyticsPanelEmpty>
        </AnalyticsPanel>
      </AnalyticsPage>
    );
  }

  const rsoMet = data.eventsHeld >= data.rsoMinimum;
  const archiveGap = data.officerArchive.length === 0;

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
          label="Waivers outstanding"
          value={String(data.waivers.uncovered)}
          tone={data.waivers.uncovered > 0 ? "warn" : "neutral"}
          meta={
            data.waivers.uncovered === 0
              ? "Every approved member is covered for this season."
              : "Approved members who cannot borrow gear or join a trip until they sign."
          }
        />
        <StatTile
          label="Events held"
          value={String(data.eventsHeld)}
          tone={rsoMet ? "neutral" : "crit"}
          meta={
            rsoMet
              ? `RSO minimum of ${data.rsoMinimum} met. Cancelled events are not counted.`
              : `Below UC’s RSO minimum of ${data.rsoMinimum} for the year.`
          }
        />
        <StatTile
          label="Emergency contacts missing"
          value={String(data.missingEmergencyContacts)}
          tone={data.missingEmergencyContacts > 0 ? "warn" : "neutral"}
          meta="Approved members with nobody on file to call from a trailhead."
        />
      </StatTileRow>

      <AnalyticsPanel
        title="Waiver coverage"
        note={`Cycle ${data.waivers.cycle} · waiver ${data.waivers.version}`}
      >
        <CoverageBar
          covered={data.waivers.covered}
          total={data.waivers.approved}
          coveredLabel="covered"
          missingLabel="still owe a signed waiver"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          The waiver term is the season: an attestation signed in January covers
          the member back to the August that opened it, and stops counting the
          moment the next season does.
        </p>
      </AnalyticsPanel>

      <AnalyticsPanel
        title="When members sign"
        note="Per month, because the three periods are unequal"
      >
        {data.attestationsBySemester.every((s) => s.attestations === 0) ? (
          <AnalyticsPanelEmpty>
            No attestations recorded for season {data.season} yet.
          </AnalyticsPanelEmpty>
        ) : (
          <ul className="divide-y text-sm">
            {data.attestationsBySemester.map((row) => (
              <li
                key={row.semester}
                className="flex items-baseline justify-between py-2"
              >
                <span className="font-medium">{row.label}</span>
                <span className="tabular-nums">
                  {row.attestations}
                  <span className="ml-2 text-muted-foreground">
                    {row.perMonth.toFixed(1)}/month
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Fall spans five months, Spring four and Summer three, so the raw
          totals are not comparable to each other — the per-month figure is.
        </p>
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Officer archive"
        note="Seasons with a recorded exec board"
      >
        {archiveGap ? (
          <AnalyticsPanelEmpty>
            No officer history recorded. Continuity across handovers is a
            constitutional obligation, so an empty archive is a gap rather than
            a quiet state.
          </AnalyticsPanelEmpty>
        ) : (
          <ul className="divide-y text-sm">
            {data.officerArchive.map((row) => (
              <li
                key={row.schoolYear}
                className="flex items-baseline justify-between py-2"
              >
                <span className="font-medium tabular-nums">
                  {row.schoolYear}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {row.roles} {row.roles === 1 ? "seat" : "seats"} recorded
                </span>
              </li>
            ))}
          </ul>
        )}
      </AnalyticsPanel>
    </AnalyticsPage>
  );
}

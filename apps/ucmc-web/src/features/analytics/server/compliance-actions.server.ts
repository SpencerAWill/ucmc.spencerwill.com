/**
 * Read-side actions for `/analytics/compliance` — the obligations with
 * consequences behind them, rather than vanity metrics.
 *
 * Everything here is answerable from columns that exist today; nothing
 * in this file needs a new table.
 *
 * The shell wrapper is in `./analytics-fns.ts`.
 */
import { and, count, eq, gte, isNull, lt, notInArray, sql } from "drizzle-orm";

import { WAIVER_VERSION } from "#/config/legal";
import {
  SEMESTER_ORDER,
  SEMESTERS,
  currentSeason,
  seasonBoundsFor,
  semesterBoundsFor,
} from "#/config/club-season";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";
import { currentAttestationFilter } from "#/server/waivers/current-attestation.server";

/**
 * UC requires an RSO to hold at least two events in an academic year
 * to stay registered. Hard-coded rather than a site setting because it
 * is UC's rule, not the club's preference — a switch implying officers
 * may change it would be a lie.
 */
const RSO_MINIMUM_EVENTS = 2;

export interface WaiverCoverage {
  cycle: string;
  version: string;
  /** Approved members, the denominator that makes the share readable. */
  approved: number;
  covered: number;
  /**
   * Deliberately BOTH, and count first. Per §3 of #267: at a few
   * hundred members a percentage moves by whole points for one person,
   * so the share is the supporting figure, not the headline.
   */
  uncovered: number;
}

/** When members actually sign, bucketed by reporting period. */
export interface AttestationsBySemester {
  semester: string;
  label: string;
  attestations: number;
  /**
   * Fall is 5 months, Spring 4, Summer 3 — so a raw total makes Fall
   * look busier for free. Divided here rather than in the component,
   * so every consumer gets the corrected figure.
   */
  perMonth: number;
}

export interface OfficerArchiveYear {
  schoolYear: string;
  roles: number;
}

export interface ComplianceAnalytics {
  season: string;
  waivers: WaiverCoverage;
  attestationsBySemester: AttestationsBySemester[];
  /** Events held this season, against UC's RSO minimum. */
  eventsHeld: number;
  rsoMinimum: number;
  /** Most recent first; a season with no row is a gap in the archive. */
  officerArchive: OfficerArchiveYear[];
  /** Approved members with no emergency contact on file. */
  missingEmergencyContacts: number;
}

/**
 * Waiver standing is the sensitive half of this page, so the gate is
 * the waiver-view pair rather than a generic analytics permission —
 * `waivers:verify` implies `waivers:view` and there is no implication
 * mechanism in the RBAC tables, which is why the OR is spelled at the
 * gate (see `WAIVER_VIEW_PERMISSIONS`).
 *
 * Reads the REAL principal: role emulation is a client-side preview
 * and must never widen what an action answers.
 */
async function requireComplianceViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("analytics:view")) {
    throw new Error("Forbidden: missing analytics:view");
  }
  const canReadWaivers =
    principal.permissions.includes("waivers:view") ||
    principal.permissions.includes("waivers:verify");
  if (!canReadWaivers) {
    throw new Error("Forbidden: missing waivers:view");
  }
  return principal;
}

export async function complianceAnalyticsAction(input: {
  season?: string;
}): Promise<ComplianceAnalytics> {
  await requireComplianceViewer();

  const season = input.season ?? currentSeason();
  const bounds = seasonBoundsFor(season);
  const start = bounds.start.toInstant();
  const end = bounds.end.toInstant();
  const db = getDb();

  const [approved] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(eq(schema.users.status, "approved"));

  // An anti-join rather than loading ids and filtering in JS: the
  // officer queue already answers this shape, and pulling member ids
  // into an `inArray` would walk straight into D1's 100-parameter cap
  // the moment the club outgrows 100 members.
  const [covered] = await db
    .select({ n: count() })
    .from(schema.users)
    .innerJoin(
      schema.waiverAttestations,
      eq(schema.waiverAttestations.userId, schema.users.id),
    )
    .where(
      and(
        eq(schema.users.status, "approved"),
        currentAttestationFilter(season),
      ),
    );

  const [events] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(
      and(
        gte(schema.events.startsAt, start),
        lt(schema.events.startsAt, end),
        // A cancelled event was not held, and UC's minimum counts
        // events held. Counting them would let the club satisfy a
        // registration requirement with meetings that never happened.
        isNull(schema.events.canceledAt),
      ),
    );

  const [missingContacts] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.status, "approved"),
        notInArray(
          schema.users.id,
          db
            .select({ userId: schema.emergencyContacts.userId })
            .from(schema.emergencyContacts),
        ),
      ),
    );

  return {
    season,
    waivers: {
      cycle: season,
      version: WAIVER_VERSION,
      approved: approved.n,
      covered: covered.n,
      uncovered: Math.max(approved.n - covered.n, 0),
    },
    attestationsBySemester: await loadAttestationsBySemester(season),
    eventsHeld: events.n,
    rsoMinimum: RSO_MINIMUM_EVENTS,
    officerArchive: await loadOfficerArchive(),
    missingEmergencyContacts: missingContacts.n,
  };
}

/**
 * When members sign, bucketed into the season's three reporting
 * periods.
 *
 * Bucketed in SQL by comparing against each period's own instants
 * rather than by extracting a month from the stored epoch: the
 * boundaries are Cincinnati-local, and `strftime` over a UTC epoch
 * would put an evening attestation in the following day — which at a
 * semester boundary is the wrong semester.
 */
async function loadAttestationsBySemester(
  season: string,
): Promise<AttestationsBySemester[]> {
  const db = getDb();
  const out: AttestationsBySemester[] = [];
  for (const semester of SEMESTER_ORDER) {
    const bounds = semesterBoundsFor(season, semester);
    const [row] = await db
      .select({ n: count() })
      .from(schema.waiverAttestations)
      .where(
        and(
          eq(schema.waiverAttestations.cycle, season),
          isNull(schema.waiverAttestations.revokedAt),
          gte(schema.waiverAttestations.attestedAt, bounds.start.toInstant()),
          lt(schema.waiverAttestations.attestedAt, bounds.end.toInstant()),
        ),
      );
    const meta = SEMESTERS[semester];
    out.push({
      semester,
      label: meta.label,
      attestations: row.n,
      perMonth: row.n / meta.monthCount,
    });
  }
  return out;
}

/** How complete the officer archive is, newest season first. */
async function loadOfficerArchive(): Promise<OfficerArchiveYear[]> {
  const rows = await getDb()
    .select({
      schoolYear: schema.historicalOfficers.schoolYear,
      roles: count(),
    })
    .from(schema.historicalOfficers)
    .groupBy(schema.historicalOfficers.schoolYear)
    .orderBy(sql`${schema.historicalOfficers.schoolYear} DESC`);
  return rows.map((row) => ({ schoolYear: row.schoolYear, roles: row.roles }));
}

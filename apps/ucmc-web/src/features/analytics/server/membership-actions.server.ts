/**
 * Read-side actions for `/analytics/membership` — who is in the club,
 * how that changed, and whether people come back.
 *
 * Every figure comes from timestamps `users` already carries
 * (`createdAt` / `approvedAt` / `rejectedAt` / `deactivatedAt`) plus
 * attestation cycles. No new table.
 *
 * **Retention here is attestation-based, and that is a real
 * limitation worth stating rather than hiding.** "Came back" means
 * "signed a waiver again in the following season", which is the only
 * continuous, per-member, per-season signal the schema holds today. It
 * undercounts a member who stayed involved without signing, and the
 * page says so.
 *
 * The shell wrapper is in `./analytics-fns.ts`.
 */
import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";

import {
  currentSeason,
  seasonBoundsFor,
  seasonOffsetOf,
} from "#/config/club-season";
import { CLUB_TIME_ZONE } from "#/config/time";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

export interface StatusFunnel {
  status: string;
  members: number;
}

/** New members in one month of one season, for the overlay. */
export interface JoinsByMonth {
  season: string;
  /** 0 = August, 11 = July. */
  monthIndex: number;
  joined: number;
}

export interface TenureBand {
  label: string;
  members: number;
}

export interface RoleCoverage {
  role: string;
  displayName: string;
  holders: number;
}

export interface MembershipAnalytics {
  season: string;
  /** The season the overlay compares against — the one before. */
  previousSeason: string;
  funnel: StatusFunnel[];
  approved: number;
  joinedThisSeason: number;
  /** Both seasons, every month present, for the two-line overlay. */
  joinsByMonth: JoinsByMonth[];
  /** Of last season's attested members, how many attested again. */
  returning: number;
  returningFrom: number;
  tenure: TenureBand[];
  roles: RoleCoverage[];
  /** Roles with nobody in them — a handover that did not complete. */
  vacantRoles: number;
}

async function requireMembershipViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("analytics:view")) {
    throw new Error("Forbidden: missing analytics:view");
  }
  const canReadMembers =
    principal.permissions.includes("members:manage") ||
    principal.permissions.includes("members:view_private");
  if (!canReadMembers) {
    throw new Error("Forbidden: missing members:manage");
  }
  return principal;
}

/** Season label one year earlier: `"2026-27"` to `"2025-26"`. */
export function previousSeasonOf(season: string): string {
  const startYear = Number.parseInt(season.slice(0, 4), 10) - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * Which month of the season an instant falls in, 0 = August.
 *
 * Resolved in `CLUB_TIME_ZONE`: the worker runs UTC, so an evening
 * sign-up on the last day of a month would otherwise land in the next
 * one — and on Jul 31 it would land in the next SEASON.
 */
function seasonMonthIndex(instant: Temporal.Instant): number {
  return (instant.toZonedDateTimeISO(CLUB_TIME_ZONE).month - 8 + 12) % 12;
}

export async function membershipAnalyticsAction(input: {
  season?: string;
}): Promise<MembershipAnalytics> {
  await requireMembershipViewer();

  const season = input.season ?? currentSeason();
  const previousSeason = previousSeasonOf(season);
  const db = getDb();

  const funnelRows = await db
    .select({ status: schema.users.status, members: count() })
    .from(schema.users)
    .groupBy(schema.users.status);

  const joins = await Promise.all(
    [season, previousSeason].map(async (label) => {
      const bounds = seasonBoundsFor(label);
      const rows = await db
        .select({ createdAt: schema.users.createdAt })
        .from(schema.users)
        .where(
          and(
            gte(schema.users.createdAt, bounds.start.toInstant()),
            lt(schema.users.createdAt, bounds.end.toInstant()),
            // Unclaimed stubs are officer bookkeeping, not people who
            // joined — counting them would show a spike on whichever
            // evening an officer typed up a paper roster.
            sql`${schema.users.status} <> 'unclaimed'`,
          ),
        );
      return { label, rows };
    }),
  );

  const approvedRow = funnelRows.find((row) => row.status === "approved");

  return {
    season,
    previousSeason,
    funnel: funnelRows
      .map((row) => ({ status: row.status, members: row.members }))
      .sort((a, b) => b.members - a.members),
    approved: approvedRow?.members ?? 0,
    joinedThisSeason:
      joins.find((entry) => entry.label === season)?.rows.length ?? 0,
    joinsByMonth: bucketJoins(
      joins.map((entry) => ({
        season: entry.label,
        instants: entry.rows.map((row) => row.createdAt),
        // Only the season currently in progress stops short. Any other
        // season on the axis has fully elapsed, including a future one
        // an officer could reach by typing a season label — which has
        // no joins at all and should render as a flat line rather than
        // as a single point.
        throughMonthIndex:
          entry.label === currentSeason() ? seasonOffsetOf().monthIndex : 11,
      })),
    ),
    ...(await loadRetention(season, previousSeason)),
    tenure: await loadTenure(),
    ...(await loadRoleCoverage()),
  };
}

/**
 * Joins per (season, season-month), each season emitted up to and
 * including `throughMonthIndex`.
 *
 * **A month with no joins and a month that has not happened are
 * different, and the overlay has to draw them differently.** A
 * completed season passes 11 and gets all twelve slots, so a quiet
 * February correctly sits at zero. The CURRENT season passes the month
 * it has actually reached: emitting zeros for the rest would draw its
 * line collapsing to the axis from November through July against last
 * season's full curve, which reads as the club falling apart rather
 * than as months that have not occurred yet.
 *
 * Within the range every month is still emitted, including empty ones
 * — two lines on one axis need the same x positions up to where they
 * end, or a line skips a slot instead of sitting at zero.
 */
export function bucketJoins(
  seasons: {
    season: string;
    instants: Temporal.Instant[];
    /** 0 = August. 11 for a season that has fully elapsed. */
    throughMonthIndex: number;
  }[],
): JoinsByMonth[] {
  const out: JoinsByMonth[] = [];
  for (const entry of seasons) {
    const counts = new Map<number, number>();
    for (const instant of entry.instants) {
      const index = seasonMonthIndex(instant);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    // Clamped rather than trusted: a caller passing a raw month index
    // for a season that is not the current one would otherwise either
    // truncate a complete season or run past the end of the axis.
    const through = Math.min(Math.max(entry.throughMonthIndex, 0), 11);
    for (let monthIndex = 0; monthIndex <= through; monthIndex += 1) {
      out.push({
        season: entry.season,
        monthIndex,
        joined: counts.get(monthIndex) ?? 0,
      });
    }
  }
  return out;
}

/**
 * Of the members who attested last season, how many attested again.
 *
 * A cohorted count rather than a ratio of two totals: "approved
 * members this season over approved members last season" would count
 * a brand-new member as retention, which is growth wearing retention's
 * clothes.
 */
async function loadRetention(
  season: string,
  previousSeason: string,
): Promise<{ returning: number; returningFrom: number }> {
  const db = getDb();
  const att = schema.waiverAttestations;

  const [from] = await db
    .select({ n: sql<number>`count(distinct ${att.userId})` })
    .from(att)
    .where(and(eq(att.cycle, previousSeason), isNull(att.revokedAt)));

  const [back] = await db
    .select({ n: sql<number>`count(distinct ${att.userId})` })
    .from(att)
    .where(
      and(
        eq(att.cycle, season),
        isNull(att.revokedAt),
        sql`${att.userId} IN (
          SELECT user_id FROM waiver_attestations
          WHERE cycle = ${previousSeason} AND revoked_at IS NULL
        )`,
      ),
    );

  return { returning: back.n, returningFrom: from.n };
}

/**
 * How many members are in their first season, second, third or more.
 *
 * Counted as distinct non-revoked attestation cycles per member, which
 * is the closest thing the schema has to "seasons present". The
 * version filter is deliberately absent here, unlike the coverage
 * check: tenure is a history question, and a member's 2024-25 season
 * still happened after `WAIVER_VERSION` moved on.
 */
async function loadTenure(): Promise<TenureBand[]> {
  const rows = await getDb()
    .select({
      userId: schema.waiverAttestations.userId,
      seasons: sql<number>`count(distinct ${schema.waiverAttestations.cycle})`,
    })
    .from(schema.waiverAttestations)
    .where(isNull(schema.waiverAttestations.revokedAt))
    .groupBy(schema.waiverAttestations.userId);

  const bands = [
    { label: "First season", members: 0 },
    { label: "Second season", members: 0 },
    { label: "Third or more", members: 0 },
  ];
  for (const row of rows) {
    const index = Math.min(row.seasons, 3) - 1;
    if (index >= 0) {
      bands[index].members += 1;
    }
  }
  return bands;
}

/**
 * Who holds which role, and how many seats are empty.
 *
 * `anonymous` and `member` are excluded: the first models signed-out
 * visitors and has no members by construction, and the second follows
 * account status rather than being assigned, so both would read as
 * noise beside the seats an exec actually fills.
 */
async function loadRoleCoverage(): Promise<{
  roles: RoleCoverage[];
  vacantRoles: number;
}> {
  const rows = await getDb()
    .select({
      role: schema.roles.name,
      displayName: schema.roles.displayName,
      holders: sql<number>`count(${schema.userRoles.userId})`,
    })
    .from(schema.roles)
    .leftJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(sql`${schema.roles.name} NOT IN ('anonymous', 'member')`)
    .groupBy(schema.roles.id)
    .orderBy(sql`count(${schema.userRoles.userId}) DESC`);

  const roles = rows.map((row) => ({
    role: row.role,
    displayName: row.displayName,
    holders: row.holders,
  }));
  return {
    roles,
    vacantRoles: roles.filter((row) => row.holders === 0).length,
  };
}

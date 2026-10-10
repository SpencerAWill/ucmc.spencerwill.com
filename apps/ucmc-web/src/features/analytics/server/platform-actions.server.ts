/**
 * Read-side actions for `/analytics/platform` — what the site costs to
 * run and how close it runs to its free-tier ceilings.
 *
 * Reads the `cost_snapshots` rows the daily cron writes (issue #268 /
 * PR #273) and the `email_sends` log. **No vendor API is called from
 * here.** A page render must not depend on an external, rate-limited,
 * Alpha-stability endpoint, and the snapshot table is shared with the
 * Reports feature so both quote the same numbers — the same reasoning
 * that put the cron in front of those APIs in the first place.
 *
 * The shell wrapper is in `./analytics-fns.ts`.
 */
import { and, asc, gte, lt } from "drizzle-orm";

import { COST_SERVICES, headroomFraction } from "#/server/cost/service-catalog";
import type { CostServiceName } from "#/server/cost/service-catalog";
import { CLUB_TIME_ZONE } from "#/config/time";
import { currentSeason, seasonBoundsFor } from "#/config/club-season";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

/** Peak-period usage of one service against its own free-tier ceiling. */
export interface ServiceHeadroom {
  service: string;
  label: string;
  family: string | null;
  unit: string;
  /** Highest single-period quantity observed in the window. */
  peak: number;
  /** The civil date that peak landed on, so it can be looked up. */
  peakDay: string;
  freeLimit: number | null;
  limitPeriod: "day" | "month";
  /**
   * `peak / freeLimit`, or null when the service has no tracked limit.
   * **Never clamped** — a period that blew the cap reads over 1.
   */
  fraction: number | null;
  /** Per-period share-of-cap, oldest first, for the sparkline. */
  daily: { day: string; fraction: number }[];
}

export interface MonthlyCost {
  /** `YYYY-MM`, civil in `CLUB_TIME_ZONE`. */
  month: string;
  family: string;
  cents: number;
}

export interface EmailVolume {
  kind: string;
  sent: number;
  failed: number;
}

export interface PlatformAnalytics {
  season: string;
  /** Civil dates bounding the window, `[start, end)`. */
  windowStart: string;
  windowEnd: string;
  /**
   * Worst-first — the tightest ceiling leads, because that is the one
   * that will bite first and the only ranking an operator acts on.
   */
  headroom: ServiceHeadroom[];
  costByMonth: MonthlyCost[];
  totalCostCents: number;
  emails: EmailVolume[];
  /**
   * True when the window holds no snapshot rows at all — a different
   * claim from "every service cost nothing", and the panels render the
   * two differently.
   */
  noSnapshots: boolean;
}

/**
 * The platform page is operational rather than club data, so it gates
 * on the permission that already means "runs this site". system_admin
 * reaches it through the principal bypass regardless.
 *
 * Server-side checks read the REAL principal on purpose: role
 * emulation is a client-side preview and must never widen what an
 * action will answer.
 */
async function requirePlatformViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("analytics:view")) {
    throw new Error("Forbidden: missing analytics:view");
  }
  if (!principal.permissions.includes("settings:manage")) {
    throw new Error("Forbidden: missing settings:manage");
  }
  return principal;
}

/** `Temporal.Instant` to a civil `YYYY-MM-DD` in the club's zone. */
function clubDate(instant: Temporal.Instant): string {
  return instant.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate().toString();
}

export async function platformAnalyticsAction(input: {
  season?: string;
}): Promise<PlatformAnalytics> {
  await requirePlatformViewer();

  const season = input.season ?? currentSeason();
  const bounds = seasonBoundsFor(season);
  // `cost_snapshots.period_start` is a civil date string, not an
  // instant, so the window is compared in the same currency. Deriving
  // those civil bounds from the season's instants keeps ONE definition
  // of a season rather than re-deriving an August boundary here, which
  // is the thing `club-season.ts` exists to stop.
  const windowStart = clubDate(bounds.start.toInstant());
  const windowEnd = clubDate(bounds.end.toInstant());

  const rows = await getDb()
    .select({
      serviceName: schema.costSnapshots.serviceName,
      serviceFamily: schema.costSnapshots.serviceFamily,
      periodStart: schema.costSnapshots.periodStart,
      quantity: schema.costSnapshots.quantity,
      costCents: schema.costSnapshots.costCents,
    })
    .from(schema.costSnapshots)
    .where(
      and(
        gte(schema.costSnapshots.periodStart, windowStart),
        lt(schema.costSnapshots.periodStart, windowEnd),
      ),
    )
    .orderBy(asc(schema.costSnapshots.periodStart));

  return {
    season,
    windowStart,
    windowEnd,
    headroom: buildHeadroom(rows),
    ...buildCost(rows),
    emails: await loadEmailVolume(
      bounds.start.toInstant(),
      bounds.end.toInstant(),
    ),
    noSnapshots: rows.length === 0,
  };
}

interface SnapshotReadRow {
  serviceName: string;
  serviceFamily: string | null;
  periodStart: string;
  quantity: number | null;
  costCents: number | null;
}

/**
 * Peak-period usage per service, worst-first.
 *
 * Iterates the CATALOG rather than the rows, so a service the vendor
 * reports that we have not catalogued is skipped rather than rendered
 * against an unknown ceiling — `headroomFraction` would answer null
 * for it and the row would read as "no limit known" beside real ones.
 */
export function buildHeadroom(rows: SnapshotReadRow[]): ServiceHeadroom[] {
  const byService = new Map<string, SnapshotReadRow[]>();
  for (const row of rows) {
    const bucket = byService.get(row.serviceName);
    if (bucket) {
      bucket.push(row);
    } else {
      byService.set(row.serviceName, [row]);
    }
  }

  const out: ServiceHeadroom[] = [];
  for (const service of Object.keys(COST_SERVICES)) {
    const meta = COST_SERVICES[service as CostServiceName];
    const serviceRows = (byService.get(service) ?? []).filter(
      (row) => row.quantity !== null,
    );
    if (serviceRows.length === 0) {
      continue;
    }

    let peak = 0;
    let peakDay = serviceRows[0].periodStart;
    const daily: { day: string; fraction: number }[] = [];
    for (const row of serviceRows) {
      const quantity = row.quantity ?? 0;
      if (quantity > peak) {
        peak = quantity;
        peakDay = row.periodStart;
      }
      const fraction = headroomFraction(service, quantity);
      // A service with no tracked limit has no share-of-cap to plot.
      // It still gets a row — its raw peak is worth seeing — it just
      // contributes no sparkline points.
      if (fraction !== null) {
        daily.push({ day: row.periodStart, fraction });
      }
    }

    out.push({
      service,
      label: meta.label,
      family: meta.family,
      unit: meta.unit,
      peak,
      peakDay,
      freeLimit: meta.freeLimit,
      limitPeriod: meta.limitPeriod,
      fraction: headroomFraction(service, peak),
      daily,
    });
  }

  // Worst first. A service with no tracked limit sorts LAST rather than
  // as zero: "no known ceiling" is not "lots of headroom", and putting
  // it at the top of a worst-first list would say exactly that.
  return out.sort((a, b) => (b.fraction ?? -1) - (a.fraction ?? -1));
}

export function buildCost(rows: SnapshotReadRow[]): {
  costByMonth: MonthlyCost[];
  totalCostCents: number;
} {
  const byKey = new Map<string, MonthlyCost>();
  let total = 0;
  for (const row of rows) {
    if (row.costCents === null || row.costCents === 0) {
      continue;
    }
    total += row.costCents;
    // `period_start` is already a civil date in the club's zone, so the
    // month prefix is string math rather than another zone conversion.
    const month = row.periodStart.slice(0, 7);
    const family = row.serviceFamily ?? "Other";
    const existing = byKey.get(`${month} ${family}`);
    if (existing) {
      existing.cents += row.costCents;
    } else {
      byKey.set(`${month} ${family}`, { month, family, cents: row.costCents });
    }
  }
  return {
    costByMonth: [...byKey.values()].sort(
      (a, b) =>
        a.month.localeCompare(b.month) || a.family.localeCompare(b.family),
    ),
    totalCostCents: total,
  };
}

/**
 * Which notification categories actually drive sending.
 *
 * Reads `email_sends` rather than the `resend.sends` snapshot series:
 * the snapshot carries the daily TOTAL, which is what the free-tier
 * ceiling applies to, while the breakdown by kind exists only in our
 * own log.
 */
async function loadEmailVolume(
  start: Temporal.Instant,
  end: Temporal.Instant,
): Promise<EmailVolume[]> {
  const rows = await getDb()
    .select({ kind: schema.emailSends.kind, ok: schema.emailSends.ok })
    .from(schema.emailSends)
    .where(
      and(
        gte(schema.emailSends.sentAt, start),
        lt(schema.emailSends.sentAt, end),
      ),
    );

  const byKind = new Map<string, EmailVolume>();
  for (const row of rows) {
    const existing = byKind.get(row.kind) ?? {
      kind: row.kind,
      sent: 0,
      failed: 0,
    };
    if (row.ok) {
      existing.sent += 1;
    } else {
      existing.failed += 1;
    }
    byKind.set(row.kind, existing);
  }
  // A failed send still consumed quota and still means a member did not
  // get their email, so rank by total attempted rather than by success.
  return [...byKind.values()].sort(
    (a, b) => b.sent + b.failed - (a.sent + a.failed),
  );
}

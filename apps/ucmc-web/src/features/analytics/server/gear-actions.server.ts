/**
 * Read-side actions for `/analytics/gear` — what the inventory is
 * doing and where it is.
 *
 * Answerable from `gear_items`, `gear_loans` and `gear_inspections` as
 * they stand; no new table.
 *
 * **Quantity loans are counted as loans, not as units.** A counted
 * checkout (`model_id` + `quantity`, issue #223) is one borrowing
 * event the same way a coded checkout is, and utilisation here means
 * "how often does the cave hand something out". Unit-level utilisation
 * is a different question that needs the stock levels alongside it,
 * and conflating the two would silently weight a five-carabiner
 * checkout as five trips to the desk.
 *
 * The shell wrapper is in `./analytics-fns.ts`.
 */
import { and, count, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { currentSeason, seasonBoundsFor } from "#/config/club-season";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

/**
 * The overdue bands, in days past due.
 *
 * These are **the same rungs the reminder ladder already uses**
 * (`features/gear/lib/loan-reminders.ts`), deliberately: an officer
 * reading "8 loans in the 8–21 band" should be looking at exactly the
 * loans that have had the second reminder and not the third. A report
 * that invented its own bands would describe a population no workflow
 * acts on.
 */
export const OVERDUE_BANDS = [
  { key: "1-7", label: "1–7 days", from: 1, to: 8 },
  { key: "8-21", label: "8–21 days", from: 8, to: 22 },
  { key: "22+", label: "22+ days", from: 22, to: Number.POSITIVE_INFINITY },
] as const;

export interface OverdueBand {
  key: string;
  label: string;
  loans: number;
}

export interface ModelBorrowCount {
  model: string;
  manufacturer: string | null;
  loans: number;
}

export interface GearAnalytics {
  season: string;
  /** Items with `status = 'active'` — the loanable inventory. */
  activeItems: number;
  /**
   * Coded items currently out — open loans carrying an `item_id`.
   *
   * Deliberately excludes counted/model loans so it stays commensurate
   * with `activeItems`, which counts `gear_items` rows and can never
   * contain them. See `countedLoansOut`.
   */
  outNow: number;
  /**
   * Open counted loans — one per checkout event, not per unit.
   *
   * Reported beside `outNow` rather than folded into it: they have no
   * `gear_items` row to be a share of, so they belong to no
   * utilisation ratio until counted checkout (#223) brings stock
   * levels into the denominator.
   */
  countedLoansOut: number;
  overdueNow: number;
  overdueBands: OverdueBand[];
  /** Loans opened within the season. */
  loansThisSeason: number;
  /**
   * Median rather than mean: one forgotten rope returned in April
   * drags a mean across the whole season, and the question officers
   * actually ask is "how long does a normal loan run".
   */
  medianLoanDays: number | null;
  mostBorrowed: ModelBorrowCount[];
  /** Items never loaned in the season — the budget question. */
  neverBorrowed: number;
  /** Items whose latest inspection failed, or that have none at all. */
  failedInspections: number;
  uninspectedItems: number;
  unitsLost: number;
}

async function requireGearViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("analytics:view")) {
    throw new Error("Forbidden: missing analytics:view");
  }
  const canReadGear =
    principal.permissions.includes("gear:read") ||
    principal.permissions.includes("gear:manage") ||
    principal.permissions.includes("gear:loan");
  if (!canReadGear) {
    throw new Error("Forbidden: missing gear:read");
  }
  return principal;
}

export async function gearAnalyticsAction(input: {
  season?: string;
  now?: number;
}): Promise<GearAnalytics> {
  await requireGearViewer();

  const season = input.season ?? currentSeason();
  const bounds = seasonBoundsFor(season);
  const start = bounds.start.toInstant();
  const end = bounds.end.toInstant();
  // The clock is a parameter so overdue banding is testable at a fixed
  // instant rather than relative to whenever the suite happens to run.
  const now =
    input.now === undefined
      ? Temporal.Now.instant()
      : Temporal.Instant.fromEpochMilliseconds(input.now);
  const db = getDb();

  const [activeItems] = await db
    .select({ n: count() })
    .from(schema.gearItems)
    .where(eq(schema.gearItems.status, "active"));

  // **Coded items only.** `utilisation` divides this by a count of
  // `gear_items` rows, so a counted/model loan ("six draws" — one row
  // carrying `model_id` and a quantity) in the numerator inflates a
  // ratio whose denominator cannot contain it, and a small inventory
  // with a few counted checkouts reads over 100% utilisation. The
  // `gear_loans_item_xor_model` check means filtering on `item_id`
  // partitions loans cleanly; the counted ones are counted separately
  // below rather than dropped, so they stay visible.
  const [outNow] = await db
    .select({ n: count() })
    .from(schema.gearLoans)
    .where(
      and(
        isNull(schema.gearLoans.returnedAt),
        isNotNull(schema.gearLoans.itemId),
      ),
    );

  const [countedOut] = await db
    .select({ n: count() })
    .from(schema.gearLoans)
    .where(
      and(
        isNull(schema.gearLoans.returnedAt),
        isNotNull(schema.gearLoans.modelId),
      ),
    );

  const openLoans = await db
    .select({ dueAt: schema.gearLoans.dueAt })
    .from(schema.gearLoans)
    .where(isNull(schema.gearLoans.returnedAt));

  const seasonLoans = await db
    .select({
      checkedOutAt: schema.gearLoans.checkedOutAt,
      returnedAt: schema.gearLoans.returnedAt,
      quantityLost: schema.gearLoans.quantityLost,
    })
    .from(schema.gearLoans)
    .where(
      and(
        gte(schema.gearLoans.checkedOutAt, start),
        lt(schema.gearLoans.checkedOutAt, end),
      ),
    );

  return {
    season,
    activeItems: activeItems.n,
    outNow: outNow.n,
    countedLoansOut: countedOut.n,
    ...bandOverdue(openLoans, now),
    loansThisSeason: seasonLoans.length,
    medianLoanDays: medianLoanDays(seasonLoans),
    mostBorrowed: await loadMostBorrowed(start, end),
    neverBorrowed: await countNeverBorrowed(start, end),
    ...(await loadInspectionHealth()),
    unitsLost: seasonLoans.reduce((sum, loan) => sum + loan.quantityLost, 0),
  };
}

/**
 * Split open loans into the reminder ladder's own bands.
 *
 * Done in JS rather than SQL because the bands are a policy constant
 * shared with the reminder job, and expressing them as three CASE
 * expressions would be a second copy of that policy living in a query.
 */
export function bandOverdue(
  openLoans: { dueAt: Temporal.Instant }[],
  now: Temporal.Instant,
): { overdueNow: number; overdueBands: OverdueBand[] } {
  const bands = OVERDUE_BANDS.map((band) => ({
    key: band.key,
    label: band.label,
    loans: 0,
  }));
  let overdue = 0;

  for (const loan of openLoans) {
    const daysLate = Math.floor(now.since(loan.dueAt).total({ unit: "day" }));
    if (daysLate < 1) {
      continue;
    }
    overdue += 1;
    const index = OVERDUE_BANDS.findIndex(
      (band) => daysLate >= band.from && daysLate < band.to,
    );
    if (index >= 0) {
      bands[index].loans += 1;
    }
  }
  return { overdueNow: overdue, overdueBands: bands };
}

/**
 * Median days from checkout to return, over closed loans only.
 *
 * Open loans are excluded rather than measured to "now": a loan still
 * running has no duration yet, and treating today as its return date
 * would make the median shrink every time someone checks something out.
 */
export function medianLoanDays(
  loans: {
    checkedOutAt: Temporal.Instant;
    returnedAt: Temporal.Instant | null;
  }[],
): number | null {
  const durations = loans
    .filter(
      (loan): loan is typeof loan & { returnedAt: Temporal.Instant } =>
        loan.returnedAt !== null,
    )
    .map((loan) =>
      loan.returnedAt.since(loan.checkedOutAt).total({ unit: "day" }),
    )
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return null;
  }
  const mid = Math.floor(durations.length / 2);
  // Even counts average the two middle values, which is the definition
  // — taking the upper one would bias every even-sized season long.
  return durations.length % 2 === 1
    ? durations[mid]
    : (durations[mid - 1] + durations[mid]) / 2;
}

async function loadMostBorrowed(
  start: Temporal.Instant,
  end: Temporal.Instant,
): Promise<ModelBorrowCount[]> {
  // Joins through the item to its model so coded and counted loans both
  // land on the same model row — a loan carries EITHER an item or a
  // model (the `gear_loans_item_xor_model` check), and counting only
  // one shape would under-report whichever the cave uses more.
  const rows = await getDb()
    .select({
      model: schema.gearModels.name,
      manufacturer: schema.gearModels.manufacturer,
      loans: count(),
    })
    .from(schema.gearLoans)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearLoans.itemId),
    )
    .innerJoin(
      schema.gearModels,
      sql`${schema.gearModels.id} = coalesce(${schema.gearLoans.modelId}, ${schema.gearItems.modelId})`,
    )
    .where(
      and(
        gte(schema.gearLoans.checkedOutAt, start),
        lt(schema.gearLoans.checkedOutAt, end),
      ),
    )
    .groupBy(schema.gearModels.id)
    .orderBy(sql`count(*) DESC`)
    .limit(8);
  return rows.map((row) => ({
    model: row.model,
    manufacturer: row.manufacturer,
    loans: row.loans,
  }));
}

/**
 * Active items with no loan in the window.
 *
 * The budget question, and the reason it is a count rather than a list:
 * "nine things nobody took this season" is the figure that starts the
 * conversation, and the list belongs on `/gear` where an officer can
 * act on each row.
 */
async function countNeverBorrowed(
  start: Temporal.Instant,
  end: Temporal.Instant,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.gearItems)
    .where(
      and(
        eq(schema.gearItems.status, "active"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.gearLoans}
          WHERE ${schema.gearLoans.itemId} = ${schema.gearItems.id}
            AND ${schema.gearLoans.checkedOutAt} >= ${start.epochMilliseconds}
            AND ${schema.gearLoans.checkedOutAt} < ${end.epochMilliseconds}
        )`,
      ),
    );
  return row.n;
}

/**
 * Inspection standing across the active inventory.
 *
 * "Latest inspection failed" and "never inspected" are counted
 * separately on purpose. They need different actions — one item is
 * known-bad and off the shelf, the other is an unknown that may be
 * perfectly fine — and folding them into one "not passing" figure
 * would hide which of the two the cave actually has.
 */
async function loadInspectionHealth(): Promise<{
  failedInspections: number;
  uninspectedItems: number;
}> {
  const db = getDb();

  // A correlated "latest row per item" subquery rather than a join
  // against `max(inspected_at)`.
  //
  // The join version matched EVERY inspection sharing that maximum,
  // and `inspected_at` is officer-entered after the fact — so a
  // same-day fail-then-repass produced two rows at the same instant,
  // counted the item twice, and still classified it as failing because
  // the filter only asked whether SOME row at the max was a fail.
  //
  // `ORDER BY inspected_at DESC LIMIT 1` is also what
  // `latestInspectionByItemIds` in `features/gear` does, so the panel
  // and the rest of the app now agree about which inspection is the
  // latest. The `id DESC` tiebreak is additional: it makes the choice
  // deterministic rather than letting SQLite pick among equal rows.
  const [failed] = await db
    .select({ n: count() })
    .from(schema.gearItems)
    .where(
      and(
        eq(schema.gearItems.status, "active"),
        sql`(
          SELECT ins.result FROM ${schema.gearInspections} ins
          WHERE ins.item_id = ${schema.gearItems.id}
          ORDER BY ins.inspected_at DESC, ins.id DESC
          LIMIT 1
        ) = 'fail'`,
      ),
    );

  const [uninspected] = await db
    .select({ n: count() })
    .from(schema.gearItems)
    .where(
      and(
        eq(schema.gearItems.status, "active"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.gearInspections}
          WHERE ${schema.gearInspections.itemId} = ${schema.gearItems.id}
        )`,
      ),
    );

  return { failedInspections: failed.n, uninspectedItems: uninspected.n };
}

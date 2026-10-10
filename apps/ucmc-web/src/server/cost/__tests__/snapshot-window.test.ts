import { describe, expect, it } from "vitest";

import {
  ANALYTICS_MAX_RANGE_DAYS,
  MAX_RANGE_DAYS,
  TRAILING_DAYS,
  analyticsWindow,
  planSnapshotWindow,
} from "#/server/cost/snapshot-window";

const TODAY = "2026-10-09";

const plan = (earliestSnapshot: string | null, backfillComplete = false) =>
  planSnapshotWindow({ today: TODAY, earliestSnapshot, backfillComplete });

const spanDays = (w: { from: string; to: string }) =>
  Temporal.PlainDate.from(w.from).until(Temporal.PlainDate.from(w.to)).days;

describe("planSnapshotWindow", () => {
  it("takes the most recent full window when nothing is recorded yet", () => {
    // Freshest data first, so a run that never gets a second tick still
    // leaves something useful behind.
    const w = plan(null);
    expect(w.mode).toBe("backfill");
    expect(w.to).toBe(TODAY);
    expect(w.from).toBe("2026-07-12");
  });

  it("never asks for more than the API accepts", () => {
    // 92 days is rejected outright with `max_date_range_days`; 90 is the
    // measured ceiling.
    for (const earliest of [null, "2026-07-12", "2026-06-23"]) {
      expect(spanDays(plan(earliest))).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    }
  });

  it("walks one window further back per run, not all of them", () => {
    // The daily cron shares a CPU budget with the retention sweeps and
    // gear reminders; a backfill spread over days beats one that takes
    // the tick down.
    const first = plan("2026-07-12");
    expect(first.mode).toBe("backfill");
    expect(first.to).toBe("2026-07-12");
    expect(first.from).toBe("2026-04-13");
  });

  it("overlaps the oldest held day by one, so no day falls between windows", () => {
    const held = "2026-07-12";
    expect(plan(held).to).toBe(held);
  });

  it("settles into a trailing window once history bottoms out", () => {
    // Retention is undocumented and shallower than the subscription — on
    // this account data stops ~108 days back though the subscription
    // began ~180 days back. Without this the run would re-request an
    // empty window every day forever.
    const w = plan("2026-06-23", true);
    expect(w.mode).toBe("trailing");
    expect(w.to).toBe(TODAY);
    expect(w.from).toBe("2026-10-06");
    expect(spanDays(w)).toBe(TRAILING_DAYS);
  });

  it("keeps re-reading recent days rather than freezing them", () => {
    // Vendor data settles after the fact; a figure read once and never
    // revisited can stay wrong forever with nobody the wiser.
    const w = plan("2026-06-23", true);
    expect(w.from < w.to).toBe(true);
    expect(w.to).toBe(TODAY);
  });

  it("ignores the recorded earliest once backfill is complete", () => {
    expect(plan("2020-01-01", true)).toEqual(plan("2026-06-23", true));
  });
});

describe("analyticsWindow", () => {
  it("asks for at most what the GraphQL API will serve", () => {
    // Measured against this account on 2026-10-10: a 31-day span
    // answers for all three datasets, 32 errors with "cannot request a
    // time range wider than 4w4d". 30 keeps a day of slack because our
    // civil dates are CLUB_TIME_ZONE and the filter is read in UTC.
    const { from, to } = analyticsWindow("2026-10-10");
    expect(to).toBe("2026-10-10");
    expect(spanDays({ from, to })).toBeLessThanOrEqual(31);
  });

  it("is trailing, and identical whatever billing is doing", () => {
    // The deadlock this fixes: analytics was handed the BILLING
    // window, which is 90 days in backfill mode, so it errored on
    // every backfill run. The failure landed in `sourcesFailed`, and
    // the backfill floor is only recorded when that is empty — so the
    // mode never flipped to trailing, the window stayed 90 days, and
    // Workers, D1 and KV produced no rows ever while R2 filled in
    // normally. These two must not share a window again.
    const backfill = planSnapshotWindow({
      today: "2026-10-10",
      earliestSnapshot: "2026-08-01",
      backfillComplete: false,
    });
    expect(backfill.mode).toBe("backfill");

    const analytics = analyticsWindow("2026-10-10");
    expect(spanDays(backfill)).toBe(MAX_RANGE_DAYS);
    expect(spanDays(analytics)).toBe(ANALYTICS_MAX_RANGE_DAYS);
    expect(spanDays(analytics)).toBeLessThan(spanDays(backfill));
  });

  it("ends on the requested day rather than yesterday", () => {
    // Today's partial figures are wanted — the trailing re-read
    // upserts them again tomorrow once they settle.
    expect(analyticsWindow("2027-01-01").to).toBe("2027-01-01");
  });

  it("walks the calendar rather than subtracting fixed milliseconds", () => {
    // Crosses a month and a year boundary; PlainDate arithmetic is
    // what makes this right without a zone round-trip.
    expect(analyticsWindow("2027-01-15").from).toBe("2026-12-16");
  });
});

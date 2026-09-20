import { describe, expect, it } from "vitest";

import {
  inspectionState,
  isSafetyFlag,
  serviceLifeState,
} from "#/features/gear/lib/safety";

const TZ = "America/New_York";
/** Mid-afternoon Cincinnati time, so the assertions read as calendar
 *  arithmetic rather than clock drift. */
const NOW = Temporal.Instant.from("2026-09-16T19:00:00Z");

function daysAgo(days: number): Temporal.Instant {
  return NOW.toZonedDateTimeISO(TZ).subtract({ days }).toInstant();
}

describe("inspectionState", () => {
  it("reports no cadence as untracked, not as a problem", () => {
    // A nut tool does not get inspected on a schedule; reporting that
    // as overdue would bury the gear that genuinely is.
    expect(
      inspectionState({
        intervalDays: null,
        lastInspectedAt: daysAgo(900),
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("untracked");
  });

  it("distinguishes never-inspected from overdue", () => {
    // Different jobs: one is a backlog item, the other is a gap in the
    // records the cave may not know it has.
    expect(
      inspectionState({
        intervalDays: 180,
        lastInspectedAt: null,
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("never");
  });

  it("walks ok → due_soon → overdue as the interval elapses", () => {
    const at = (daysSince: number) =>
      inspectionState({
        intervalDays: 180,
        lastInspectedAt: daysAgo(daysSince),
        now: NOW,
        timeZone: TZ,
      });
    expect(at(10).status).toBe("ok");
    // Two weeks out is the amber window.
    expect(at(170).status).toBe("due_soon");
    expect(at(181).status).toBe("overdue");
  });

  it("counts days from the last inspection, not from acquisition", () => {
    const state = inspectionState({
      intervalDays: 30,
      lastInspectedAt: daysAgo(40),
      now: NOW,
      timeZone: TZ,
    });
    // Negative so a sort by this key puts the worst offender first.
    expect(state.daysUntilDue).toBe(-10);
  });

  it("treats the due date itself as due_soon, not overdue", () => {
    const state = inspectionState({
      intervalDays: 30,
      lastInspectedAt: daysAgo(30),
      now: NOW,
      timeZone: TZ,
    });
    expect(state.daysUntilDue).toBe(0);
    expect(state.status).toBe("due_soon");
  });
});

describe("serviceLifeState", () => {
  it("reports no service life as untracked", () => {
    expect(
      serviceLifeState({
        serviceLifeYears: null,
        manufacturedAt: daysAgo(9000),
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("untracked");
  });

  it("separates 'ages out but we never read the tag' from 'never ages out'", () => {
    // `unknown` is a gap somebody can close by reading the tag;
    // `untracked` is not a gap at all. Collapsing them would hide work.
    expect(
      serviceLifeState({
        serviceLifeYears: 10,
        manufacturedAt: null,
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("unknown");
  });

  it("runs the clock from manufacture, not from purchase", () => {
    // A rope bought in 2024 from old warehouse stock is as old as the
    // day it was made.
    const made = Temporal.Instant.from("2014-01-01T12:00:00Z");
    const state = serviceLifeState({
      serviceLifeYears: 10,
      manufacturedAt: made,
      now: NOW,
      timeZone: TZ,
    });
    expect(state.status).toBe("expired");
  });

  it("warns a year out, which is when it becomes a budget line", () => {
    const made = NOW.toZonedDateTimeISO(TZ)
      .subtract({ years: 9, months: 6 })
      .toInstant();
    expect(
      serviceLifeState({
        serviceLifeYears: 10,
        manufacturedAt: made,
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("expiring");
  });

  it("stays ok well inside the life", () => {
    const made = NOW.toZonedDateTimeISO(TZ).subtract({ years: 2 }).toInstant();
    expect(
      serviceLifeState({
        serviceLifeYears: 10,
        manufacturedAt: made,
        now: NOW,
        timeZone: TZ,
      }).status,
    ).toBe("ok");
  });

  it("counts calendar years, so a leap day inside the life is a real day", () => {
    const made = Temporal.Instant.from("2016-02-29T12:00:00Z");
    const state = serviceLifeState({
      serviceLifeYears: 10,
      manufacturedAt: made,
      now: NOW,
      timeZone: TZ,
    });
    // 2026-02-28/29 has passed by September 2026 either way; what
    // matters is that it resolves rather than throwing on Feb 29.
    expect(state.expiresAt).not.toBeNull();
    expect(state.status).toBe("expired");
  });
});

describe("isSafetyFlag", () => {
  it("badges only what somebody has to act on", () => {
    for (const status of [
      "overdue",
      "never",
      "due_soon",
      "expired",
      "expiring",
      "unknown",
    ] as const) {
      expect(isSafetyFlag(status)).toBe(true);
    }
    // The quiet majority. Badging these would make the list all badge
    // and no signal.
    expect(isSafetyFlag("ok")).toBe(false);
    expect(isSafetyFlag("untracked")).toBe(false);
  });
});

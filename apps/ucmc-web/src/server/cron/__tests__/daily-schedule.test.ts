/**
 * What local time the daily cron actually lands at, across a full year.
 *
 * The expression is UTC and Cloudflare has no DST awareness, so the
 * local hour drifts. That drift is **accepted**, not accidental — but it
 * is bounded, and the bound is the thing worth pinning: anyone changing
 * the expression should have to notice they have moved the hour members
 * receive mail at.
 */
import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  DAILY_CRON_EXPRESSIONS,
  isDailyCron,
} from "#/server/cron/daily-schedule";

/** The instant the daily expression fires at on `isoDate`. */
function tickOn(isoDate: string): Temporal.Instant {
  const hour = Number.parseInt(DAILY_CRON_EXPRESSIONS[0].split(" ")[1], 10);
  return Temporal.ZonedDateTime.from(
    `${isoDate}T${String(hour).padStart(2, "0")}:00:00[UTC]`,
  ).toInstant();
}

const localHourOn = (isoDate: string): number =>
  tickOn(isoDate).toZonedDateTimeISO(CLUB_TIME_ZONE).hour;

describe("the daily cron's local hour", () => {
  it.each([
    ["deep winter (EST)", "2026-01-15", 7],
    ["the day before spring forward", "2026-03-07", 7],
    ["spring forward itself", "2026-03-08", 8],
    ["high summer (EDT)", "2026-07-04", 8],
    ["the day before fall back", "2026-10-31", 8],
    ["fall back itself", "2026-11-01", 7],
    ["the club-year rollover", "2026-08-21", 8],
  ])("is %s", (_label, isoDate, expected) => {
    expect(localHourOn(isoDate)).toBe(expected);
  });

  it("never strays outside 07:00-08:00 on any day of the year", () => {
    const start = Temporal.PlainDate.from("2026-01-01");
    const days = Array.from({ length: start.daysInYear }, (_, i) =>
      start.add({ days: i }).toString(),
    );
    expect(days.at(-1)).toBe("2026-12-31");

    // One hour of drift is the accepted cost of a single UTC expression.
    // Anything wider means the expression moved and members are being
    // mailed at an hour nobody chose - 03:00 local is where this started.
    const strays = days.filter((iso) => ![7, 8].includes(localHourOn(iso)));
    expect(strays, `days outside 07:00-08:00: ${strays.join(", ")}`).toEqual(
      [],
    );
  });

  it("fires exactly once per day", () => {
    // Pinning the count, not just the hour. The two-expression variant
    // that holds 08:00 year-round was built and then reverted over the
    // Workers Free cron cap (see daily-schedule.ts). If it ever returns,
    // it must arrive together with the gate that discards the second
    // tick - otherwise every member is mailed twice each morning.
    expect(DAILY_CRON_EXPRESSIONS).toHaveLength(1);
  });
});

describe("isDailyCron", () => {
  it("matches the registered expression and nothing else", () => {
    for (const expr of DAILY_CRON_EXPRESSIONS) {
      expect(isDailyCron(expr)).toBe(true);
    }
    // The annual officer archive has its own branch; anything else is a
    // misconfiguration the dispatcher logs rather than guesses at.
    expect(isDailyCron("15 8 1 3 *")).toBe(false);
    expect(isDailyCron("0 13 * * *")).toBe(false);
    expect(isDailyCron("0 8 * * *")).toBe(false);
  });
});

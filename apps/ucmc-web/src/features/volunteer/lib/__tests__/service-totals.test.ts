import { describe, expect, it } from "vitest";

import {
  clubYearOf,
  groupByClubYear,
  totalService,
} from "#/features/volunteer/lib/service-totals";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

function outing(
  overrides: Partial<VolunteerEventEntry> & { startsAtMs: number },
): VolunteerEventEntry {
  return {
    id: `vevt_${overrides.startsAtMs}`,
    publicId: "abcdefghijkl",
    title: "Outing",
    partnerOrg: null,
    location: null,
    endsAtMs: null,
    description: null,
    signupUrl: null,
    volunteersCount: null,
    serviceHours: null,
    albumTag: null,
    ...overrides,
  };
}

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

describe("clubYearOf", () => {
  it("rolls over on Aug 21 Cincinnati-local, like the waiver cycle", () => {
    // Aug 20 belongs to the year that is ending; Aug 21 starts the next.
    expect(
      clubYearOf(outing({ startsAtMs: at("2025-08-20T12:00:00-04:00") })),
    ).toBe("2024-25");
    expect(
      clubYearOf(outing({ startsAtMs: at("2025-08-21T00:00:00-04:00") })),
    ).toBe("2025-26");
  });

  it("reads the boundary in the club zone, not UTC", () => {
    // 23:00 EDT on Aug 20 is 03:00 UTC on Aug 21. Reading the date in
    // UTC would push this into the next club year.
    expect(clubYearOf(outing({ startsAtMs: at("2025-08-21T03:00:00Z") }))).toBe(
      "2024-25",
    );
  });
});

describe("groupByClubYear", () => {
  it("groups adjacent outings and preserves the incoming order", () => {
    const groups = groupByClubYear([
      outing({ startsAtMs: at("2026-05-01T12:00:00Z"), title: "A" }),
      outing({ startsAtMs: at("2026-03-01T12:00:00Z"), title: "B" }),
      outing({ startsAtMs: at("2024-11-01T12:00:00Z"), title: "C" }),
    ]);
    expect(groups.map((g) => g.clubYear)).toEqual(["2025-26", "2024-25"]);
    expect(groups[0]?.outings.map((o) => o.title)).toEqual(["A", "B"]);
    expect(groups[1]?.outings.map((o) => o.title)).toEqual(["C"]);
  });

  it("returns nothing for an empty archive", () => {
    expect(groupByClubYear([])).toEqual([]);
  });
});

describe("totalService", () => {
  it("sums only the outings that recorded a figure, and says how many", () => {
    const totals = totalService([
      outing({
        startsAtMs: at("2026-05-01T12:00:00Z"),
        volunteersCount: 12,
        serviceHours: 48,
      }),
      outing({ startsAtMs: at("2026-03-01T12:00:00Z"), volunteersCount: 8 }),
      outing({ startsAtMs: at("2025-11-01T12:00:00Z") }),
    ]);
    expect(totals.outings).toBe(3);
    expect(totals.volunteers).toBe(20);
    expect(totals.hours).toBe(48);
    // The denominators are what stop the strip reading as "this is all
    // we did" when it means "this is all we wrote down".
    expect(totals.volunteersReportedFor).toBe(2);
    expect(totals.hoursReportedFor).toBe(1);
  });

  it("treats a recorded zero as recorded, not as missing", () => {
    const totals = totalService([
      outing({
        startsAtMs: at("2026-05-01T12:00:00Z"),
        volunteersCount: 0,
        serviceHours: 0,
      }),
    ]);
    expect(totals.volunteersReportedFor).toBe(1);
    expect(totals.hoursReportedFor).toBe(1);
  });

  it("reports zeroes for an empty archive", () => {
    expect(totalService([])).toEqual({
      outings: 0,
      volunteers: 0,
      hours: 0,
      volunteersReportedFor: 0,
      hoursReportedFor: 0,
    });
  });
});

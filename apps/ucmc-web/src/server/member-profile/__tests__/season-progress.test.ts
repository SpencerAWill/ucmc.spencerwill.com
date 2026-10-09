import { describe, expect, it } from "vitest";

import { nextTenureBadge } from "../badge-rules";
import { seasonComplete, seasonEnd, seasonProgress } from "../season-progress";

const at = (iso: string) => Temporal.Instant.from(iso);

describe("seasonEnd", () => {
  it("lands on May 1 of the cycle's END year, midnight club-local", () => {
    const end = seasonEnd("2025-26");
    expect(end.year).toBe(2026);
    expect(end.month).toBe(5);
    expect(end.day).toBe(1);
    expect(end.hour).toBe(0);
    // Cincinnati is UTC-4 on May 1 (EDT), so local midnight is 04:00Z.
    // Reading this boundary in UTC would move the finish line by four
    // hours, which is a whole day's worth of arc at this scale.
    expect(end.toInstant().toString()).toBe("2026-05-01T04:00:00Z");
  });
});

describe("seasonComplete", () => {
  it("is false the moment before May 1 and true the moment after", () => {
    expect(seasonComplete("2025-26", at("2026-05-01T03:59:00Z"))).toBe(false);
    expect(seasonComplete("2025-26", at("2026-05-01T04:01:00Z"))).toBe(true);
  });

  it("counts the boundary instant itself as complete", () => {
    // Inclusive, so the ring closes on the stroke of midnight rather
    // than a millisecond later. The arc hits 1 at this same instant;
    // an exclusive comparison here would leave a full arc beside an
    // open ring for one tick.
    expect(seasonComplete("2025-26", at("2026-05-01T04:00:00Z"))).toBe(true);
  });

  it("stays true through the summer, before the next cycle opens", () => {
    // The gap between May 1 and the Aug 1 rollover: last season is
    // finished and the next has not started. A closed ring, no arc.
    expect(seasonComplete("2025-26", at("2026-07-04T16:00:00Z"))).toBe(true);
  });
});

describe("seasonProgress", () => {
  it("is zero at the instant the member attests", () => {
    const attested = at("2025-09-10T14:00:00Z");
    expect(seasonProgress(attested, "2025-26", attested)).toBe(0);
  });

  it("reaches one exactly at May 1, not at the August rollover", () => {
    const attested = at("2025-09-10T14:00:00Z");
    expect(
      seasonProgress(attested, "2025-26", at("2026-05-01T04:00:00Z")),
    ).toBe(1);
  });

  it("measures from the attestation date, not from the cycle opening", () => {
    // Two members in the same club year, one who signed in August and
    // one who signed in January, both looked at on the same March
    // day. The January joiner is earlier in THEIR season; an arc
    // anchored to Aug 1 would report them identically.
    const now = at("2026-03-01T12:00:00Z");
    const august = seasonProgress(at("2025-08-25T12:00:00Z"), "2025-26", now);
    const january = seasonProgress(at("2026-01-15T12:00:00Z"), "2025-26", now);
    expect(august).toBeGreaterThan(january);
    expect(january).toBeGreaterThan(0);
    expect(august).toBeLessThan(1);
  });

  it("puts a member a quarter in at a quarter of their own span", () => {
    // Attested Sep 1, finish line May 1: a ~242-day season, so the
    // quarter mark is about 60 days later.
    const attested = at("2025-09-01T04:00:00Z");
    const quarter = seasonProgress(
      attested,
      "2025-26",
      at("2025-10-31T04:00:00Z"),
    );
    expect(quarter).toBeGreaterThan(0.23);
    expect(quarter).toBeLessThan(0.27);
  });

  it("clamps rather than running past one after May 1", () => {
    // The arc is drawn straight from this number; anything above 1
    // would wrap the stroke back over itself.
    expect(
      seasonProgress(
        at("2025-09-01T04:00:00Z"),
        "2025-26",
        at("2026-08-01T04:00:00Z"),
      ),
    ).toBe(1);
  });

  it("treats attesting exactly at the finish line as a full season", () => {
    // The boundary case of the one below: `>=`, not `>`, or this
    // divides by zero and yields NaN, which paints no arc at all.
    const end = at("2026-05-01T04:00:00Z");
    expect(seasonProgress(end, "2025-26", end)).toBe(1);
  });

  it("reports a full season for someone who attested after the finish line", () => {
    // Signing in June for a cycle that ended in May: they are paid up
    // for a season that is over. Returning a negative or runaway
    // fraction here would invert the arc.
    const attested = at("2026-06-15T04:00:00Z");
    expect(
      seasonProgress(attested, "2025-26", at("2026-06-20T04:00:00Z")),
    ).toBe(1);
    expect(seasonComplete("2025-26", at("2026-06-20T04:00:00Z"))).toBe(true);
  });
});

describe("nextTenureBadge", () => {
  it("points a first-season member at their first badge", () => {
    expect(nextTenureBadge(0)).toEqual({ key: "redbud", seasonsAway: 1 });
  });

  it("names the next rung up, not the one just earned", () => {
    expect(nextTenureBadge(2)).toEqual({ key: "hemlock", seasonsAway: 1 });
  });

  it("stops once the ladder is topped out", () => {
    expect(nextTenureBadge(5)).toBeNull();
    expect(nextTenureBadge(12)).toBeNull();
  });
});

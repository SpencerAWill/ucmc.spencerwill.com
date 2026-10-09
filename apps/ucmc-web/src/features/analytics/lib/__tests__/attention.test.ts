import { describe, expect, it } from "vitest";

import { buildAttention } from "#/features/analytics/lib/attention";
import type { AttentionInputs } from "#/features/analytics/lib/attention";

const gear = (
  over: Partial<NonNullable<AttentionInputs["gear"]>> = {},
): NonNullable<AttentionInputs["gear"]> => ({
  overdueNow: 0,
  overdueBands: [
    { key: "1-7", loans: 0 },
    { key: "8-21", loans: 0 },
    { key: "22+", loans: 0 },
  ],
  failedInspections: 0,
  ...over,
});

const compliance = (
  over: Partial<NonNullable<AttentionInputs["compliance"]>> = {},
): NonNullable<AttentionInputs["compliance"]> => ({
  waivers: { uncovered: 0 },
  eventsHeld: 5,
  rsoMinimum: 2,
  ...over,
});

describe("visibility", () => {
  // The core contract: `undefined` means "this viewer cannot see that
  // dataset", which is NOT the same as "nothing is wrong there".
  it("emits nothing at all for a viewer with no datasets", () => {
    expect(buildAttention({})).toEqual([]);
  });

  it("never mentions a domain the viewer cannot see", () => {
    const items = buildAttention({ gear: gear({ overdueNow: 4 }) });
    expect(items.every((item) => item.linkLabel === "Gear")).toBe(true);
  });
});

describe("gear", () => {
  it("escalates long-overdue loans above merely-overdue ones", () => {
    // Three items 22 days gone is a loss; twelve items one day late is
    // a Tuesday. Sorting by count would invert that.
    const items = buildAttention({
      gear: gear({
        overdueNow: 3,
        overdueBands: [
          { key: "1-7", loans: 0 },
          { key: "8-21", loans: 0 },
          { key: "22+", loans: 3 },
        ],
      }),
    });
    expect(items[0].key).toBe("gear-long-overdue");
    expect(items[0].severity).toBe("act-now");
  });

  it("reports overdue once, not twice, when some are long overdue", () => {
    // The long-overdue item supersedes the general one; emitting both
    // would double-count the same loans in an exception list.
    const items = buildAttention({
      gear: gear({
        overdueNow: 5,
        overdueBands: [
          { key: "1-7", loans: 2 },
          { key: "8-21", loans: 0 },
          { key: "22+", loans: 3 },
        ],
      }),
    });
    expect(items.filter((i) => i.key.startsWith("gear-")).length).toBe(1);
  });

  it("stays quiet when nothing is overdue", () => {
    expect(buildAttention({ gear: gear() })).toEqual([]);
  });

  it("flags an active item that failed its last inspection", () => {
    const items = buildAttention({ gear: gear({ failedInspections: 2 }) });
    expect(items[0].key).toBe("gear-failed-inspection");
    expect(items[0].severity).toBe("act-now");
  });
});

describe("compliance", () => {
  it("flags uncovered waivers as act-now", () => {
    const items = buildAttention({
      compliance: compliance({ waivers: { uncovered: 9 } }),
    });
    expect(items[0].severity).toBe("act-now");
    expect(items[0].message).toContain("9 approved members have");
  });

  it("uses a singular verb for one member", () => {
    const items = buildAttention({
      compliance: compliance({ waivers: { uncovered: 1 } }),
    });
    expect(items[0].message).toContain("1 approved member has");
  });

  it("reports the RSO minimum as clear once met", () => {
    // The one deliberately positive item: an officer needs to be able
    // to confirm the obligation is satisfied, not just be told nothing
    // is wrong.
    const items = buildAttention({ compliance: compliance() });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("rso-minimum-met");
    expect(items[0].severity).toBe("clear");
  });

  it("flags the RSO minimum when short", () => {
    const items = buildAttention({
      compliance: compliance({ eventsHeld: 1, rsoMinimum: 2 }),
    });
    expect(items[0].key).toBe("rso-minimum");
    expect(items[0].severity).toBe("watch");
  });
});

describe("platform", () => {
  it("stays quiet below the watch threshold", () => {
    expect(
      buildAttention({
        platform: { headroom: [{ label: "KV writes", fraction: 0.116 }] },
      }),
    ).toEqual([]);
  });

  it("warns at the watch threshold and escalates at at-risk", () => {
    const watch = buildAttention({
      platform: { headroom: [{ label: "KV writes", fraction: 0.5 }] },
    });
    expect(watch[0].severity).toBe("watch");

    const risk = buildAttention({
      platform: { headroom: [{ label: "KV writes", fraction: 0.8 }] },
    });
    expect(risk[0].severity).toBe("act-now");
  });

  it("reports only the tightest service, not one row per service", () => {
    // Twelve healthy services is not an exception report.
    const items = buildAttention({
      platform: {
        headroom: [
          { label: "KV writes", fraction: 0.9 },
          { label: "D1 rows read", fraction: 0.85 },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].message).toContain("KV writes");
  });

  it("looks past a limitless service to the first real ceiling", () => {
    // The server already sorts nulls last, so this should not arise —
    // but "no known ceiling" must never shadow a service that is
    // actually about to blow its cap, whatever order the list arrives
    // in. Skipping to the next real fraction is the safe direction.
    const items = buildAttention({
      platform: {
        headroom: [
          { label: "Worker CPU time", fraction: null },
          { label: "KV writes", fraction: 0.95 },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].message).toContain("KV writes");
    expect(items[0].severity).toBe("act-now");
  });

  it("stays quiet when every service is limitless", () => {
    expect(
      buildAttention({
        platform: { headroom: [{ label: "Worker CPU time", fraction: null }] },
      }),
    ).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts every act-now above every watch, and watch above clear", () => {
    const items = buildAttention({
      gear: gear({
        overdueNow: 1,
        overdueBands: [
          { key: "1-7", loans: 1 },
          { key: "8-21", loans: 0 },
          { key: "22+", loans: 0 },
        ],
      }),
      compliance: compliance({ waivers: { uncovered: 2 } }),
      membership: { vacantRoles: 1 },
    });
    const ranks = items.map((item) => item.severity);
    expect(ranks[0]).toBe("act-now");
    expect(ranks).toEqual([...ranks].sort((a, b) => rank(a) - rank(b)));
  });

  it("gives every item a distinct key", () => {
    const items = buildAttention({
      gear: gear({ overdueNow: 1, failedInspections: 1 }),
      compliance: compliance({ waivers: { uncovered: 1 } }),
      platform: { headroom: [{ label: "KV", fraction: 0.9 }] },
      membership: { vacantRoles: 2 },
    });
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

function rank(severity: string): number {
  return ["act-now", "watch", "clear"].indexOf(severity);
}

import { describe, expect, it } from "vitest";

import { COST_SERVICES, headroomFraction } from "#/server/cost/service-catalog";
import type { CostServiceName } from "#/server/cost/service-catalog";

describe("COST_SERVICES", () => {
  it("gives every service a limit source, so a stale number is traceable", () => {
    // These are the one part of the feature no API can verify — they are
    // hand-entered from published plan limits and will go stale. A limit
    // with no stated source is one nobody can recheck.
    for (const [name, meta] of Object.entries(COST_SERVICES)) {
      expect(
        meta.limitSource,
        `${name} must say where its limit came from`,
      ).toBeTruthy();
    }
  });

  it("keeps service names stable and vendor-display-string free", () => {
    // Cloudflare embeds the free allowance in its display name ("R2 Data
    // Storage (First 10GB-Month included)"), which changes when the
    // allowance does. A key derived from that would split one series in
    // two the day Cloudflare edits the string, and every historical row
    // would strand under the old key.
    for (const name of Object.keys(COST_SERVICES)) {
      expect(name).toMatch(/^[a-z0-9]+\.[a-z0-9_]+$/);
      expect(name).not.toContain("(");
    }
  });

  it("meters D1 in rows, not queries", () => {
    // D1's free tier limits ROWS. The analytics dataset reports both
    // rows and queries, and metering queries would read far under the
    // real headroom — 1,709 queries against 5,056 rows on a sampled day.
    expect(COST_SERVICES["d1.rows_read"].unit).toBe("rows");
    expect(COST_SERVICES["d1.rows_written"].unit).toBe("rows");
  });
});

describe("headroomFraction", () => {
  it("reports usage as a fraction of the free allowance", () => {
    expect(headroomFraction("kv.writes", 116)).toBeCloseTo(0.116);
    expect(headroomFraction("workers.requests", 5_637)).toBeCloseTo(0.056, 3);
  });

  it("does NOT clamp above 1", () => {
    // A panel showing 140% is telling the truth about a day the cap was
    // blown. Clamping hides the one reading anybody needs to see.
    expect(headroomFraction("kv.writes", 1_400)).toBeCloseTo(1.4);
  });

  it("answers null where no limit is tracked", () => {
    // CPU time is metered per invocation, so a daily total has no cap to
    // divide by. Returning 0 would render as "no usage"; null renders as
    // "not applicable", which is the honest answer.
    expect(headroomFraction("workers.cpu_time_us", 999_999)).toBeNull();
  });

  it("is defined for every service in the catalog", () => {
    for (const name of Object.keys(COST_SERVICES) as CostServiceName[]) {
      expect(() => headroomFraction(name, 1)).not.toThrow();
    }
  });
});

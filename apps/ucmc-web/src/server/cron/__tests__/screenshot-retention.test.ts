/**
 * When a site-feedback screenshot becomes due for deletion: 30 days after
 * the report resolved. "Resolved" mirrors `siteFeedbackStateSql()` — a
 * report linked to filed issues resolves when the last of them closes;
 * an unlinked one when a maintainer closes it out. Anything that reopens
 * a report makes it not due again.
 */
import { describe, expect, it } from "vitest";

import {
  SCREENSHOT_RETENTION_DAYS,
  resolvedAt,
  screenshotPurgeDue,
} from "#/server/cron/screenshot-retention";
import type { ScreenshotRetentionInput } from "#/server/cron/screenshot-retention";

const T0 = Temporal.Instant.from("2026-09-01T12:00:00Z");
const T1 = Temporal.Instant.from("2026-09-05T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function input(
  over: Partial<ScreenshotRetentionInput> = {},
): ScreenshotRetentionInput {
  return { status: "open", statusChangedAt: null, links: [], ...over };
}

describe("resolvedAt", () => {
  it("is the latest closedAt when every filed issue is closed", () => {
    expect(
      resolvedAt(
        input({
          links: [
            { state: "closed", closedAt: T1 },
            { state: "closed", closedAt: T0 },
          ],
        }),
      ),
    ).toEqual(T1);
  });

  it("finds the latest closedAt whatever order the links come in", () => {
    expect(
      resolvedAt(
        input({
          links: [
            { state: "closed", closedAt: T0 },
            { state: "closed", closedAt: T1 },
          ],
        }),
      ),
    ).toEqual(T1);
  });

  it("is null when one closed issue's closedAt is unknown, even if another's is known", () => {
    expect(
      resolvedAt(
        input({
          links: [
            { state: "closed", closedAt: T0 },
            { state: "closed", closedAt: null },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("is null for an open issue that still carries an old closedAt", () => {
    expect(
      resolvedAt(input({ links: [{ state: "open", closedAt: T0 }] })),
    ).toBeNull();
  });

  it("ignores draft links beside filed ones", () => {
    expect(
      resolvedAt(
        input({
          links: [
            { state: "closed", closedAt: T0 },
            { state: "draft", closedAt: null },
          ],
        }),
      ),
    ).toEqual(T0);
  });

  it("is null while any filed issue is open or filing", () => {
    for (const state of ["open", "filing"] as const) {
      expect(
        resolvedAt(
          input({
            links: [
              { state: "closed", closedAt: T0 },
              { state, closedAt: null },
            ],
          }),
        ),
      ).toBeNull();
    }
  });

  it("is null for a closed issue with no closedAt (closed before it was recorded)", () => {
    expect(
      resolvedAt(input({ links: [{ state: "closed", closedAt: null }] })),
    ).toBeNull();
  });

  it("is null with only draft links, whatever the disposition says", () => {
    expect(
      resolvedAt(
        input({
          status: "wont_fix",
          statusChangedAt: T0,
          links: [{ state: "draft", closedAt: null }],
        }),
      ),
    ).toBeNull();
  });

  it.each(["resolved", "wont_fix", "duplicate", "closed"])(
    "is statusChangedAt for an unlinked %s report",
    (status) => {
      expect(resolvedAt(input({ status, statusChangedAt: T0 }))).toEqual(T0);
    },
  );

  it.each(["open", "acknowledged"])(
    "is null for an unlinked %s report",
    (status) => {
      expect(resolvedAt(input({ status, statusChangedAt: T0 }))).toBeNull();
    },
  );
});

describe("screenshotPurgeDue", () => {
  const closed = input({ status: "wont_fix", statusChangedAt: T0 });

  it("is 30 days", () => {
    expect(SCREENSHOT_RETENTION_DAYS).toBe(30);
  });

  it("due at exactly 30 days", () => {
    expect(
      screenshotPurgeDue(closed, T0.add({ milliseconds: 30 * DAY_MS })),
    ).toBe(true);
  });

  it("not due at 30 days minus 1 ms", () => {
    expect(
      screenshotPurgeDue(closed, T0.add({ milliseconds: 30 * DAY_MS - 1 })),
    ).toBe(false);
  });

  it("not due once reopened", () => {
    // Reopen restamps statusChangedAt, but the status is what decides:
    // an open report is never due, however old the stamp.
    expect(
      screenshotPurgeDue(
        input({ status: "open", statusChangedAt: T0 }),
        T0.add({ milliseconds: 365 * DAY_MS }),
      ),
    ).toBe(false);
  });

  it("not due when one of two issues is still open", () => {
    expect(
      screenshotPurgeDue(
        input({
          links: [
            { state: "closed", closedAt: T0 },
            { state: "open", closedAt: null },
          ],
        }),
        T0.add({ milliseconds: 365 * DAY_MS }),
      ),
    ).toBe(false);
  });

  it("not due with a null closedAt", () => {
    expect(
      screenshotPurgeDue(
        input({ links: [{ state: "closed", closedAt: null }] }),
        T0.add({ milliseconds: 365 * DAY_MS }),
      ),
    ).toBe(false);
  });

  it("not due for a legacy resolved row with null statusChangedAt", () => {
    expect(
      screenshotPurgeDue(
        input({ status: "resolved", statusChangedAt: null }),
        T0.add({ milliseconds: 365 * DAY_MS }),
      ),
    ).toBe(false);
  });

  it("measures 30 days of elapsed time across a DST change", () => {
    // Nov 1 2026 is a fall-back day in the club's zone; elapsed-time
    // arithmetic must not care.
    const start = Temporal.Instant.from("2026-10-20T12:00:00Z");
    const report = input({ status: "duplicate", statusChangedAt: start });
    expect(
      screenshotPurgeDue(report, start.add({ milliseconds: 30 * DAY_MS })),
    ).toBe(true);
    expect(
      screenshotPurgeDue(report, start.add({ milliseconds: 30 * DAY_MS - 1 })),
    ).toBe(false);
  });
});

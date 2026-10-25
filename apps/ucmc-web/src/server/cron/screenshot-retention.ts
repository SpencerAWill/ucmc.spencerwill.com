/**
 * When a site-feedback screenshot is due for deletion: 30 days after its
 * report resolved. Pure, every input a parameter including `now`, so it
 * is mutation-testable; the sweep in `retention.server.ts` is plumbing.
 *
 * Lives in `src/server/cron/` rather than `features/site-feedback`
 * because the sweep may not import a feature.
 *
 * "Resolved" mirrors `siteFeedbackStateSql()` in the site-feedback
 * triage repo, which derives state on read:
 *
 *   - linked to filed (non-draft) issues: resolved when every one is
 *     closed, at the latest `closed_at`;
 *   - linked only to drafts: never resolved (it reads as "in draft");
 *   - unlinked: resolved when a maintainer set a closing disposition, at
 *     `status_changed_at`.
 *
 * A missing timestamp means "we don't know when", and an unknown
 * resolution time is never due: rows resolved before the columns existed
 * keep their screenshots rather than being purged on a guess (the same
 * NULL-skip discipline as the other sweeps).
 *
 * Elapsed time, not calendar days, so a DST change can't move the
 * deadline (see `testing.md`, "Time").
 */
export const SCREENSHOT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `feedback.status` values that close out an unlinked report. */
const CLOSING_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "wont_fix",
  "duplicate",
  "closed",
]);

export interface ScreenshotRetentionInput {
  /** `feedback.status`. */
  status: string;
  statusChangedAt: Temporal.Instant | null;
  links: {
    state: "draft" | "filing" | "open" | "closed";
    closedAt: Temporal.Instant | null;
  }[];
}

export function resolvedAt(
  input: ScreenshotRetentionInput,
): Temporal.Instant | null {
  const filed = input.links.filter((link) => link.state !== "draft");
  if (filed.length > 0) {
    let latest: Temporal.Instant | null = null;
    for (const link of filed) {
      if (link.state !== "closed" || link.closedAt === null) {
        return null;
      }
      if (
        latest === null ||
        Temporal.Instant.compare(link.closedAt, latest) > 0
      ) {
        latest = link.closedAt;
      }
    }
    return latest;
  }
  if (input.links.length > 0) {
    return null;
  }
  return CLOSING_STATUSES.has(input.status) ? input.statusChangedAt : null;
}

export function screenshotPurgeDue(
  input: ScreenshotRetentionInput,
  now: Temporal.Instant,
): boolean {
  const at = resolvedAt(input);
  if (at === null) {
    return false;
  }
  const due = at.add({ milliseconds: SCREENSHOT_RETENTION_DAYS * DAY_MS });
  return Temporal.Instant.compare(now, due) >= 0;
}

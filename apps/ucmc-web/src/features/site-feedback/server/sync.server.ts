/**
 * Issue-state sync: asks GitHub whether each tracked issue is still open
 * and mirrors the answer into `site_feedback_issues`.
 *
 * Only `state = 'open'` rows with a `github_number` are checked, so a
 * closed issue that is reopened on GitHub isn't noticed. A null answer
 * (deleted or transferred) counts as closed. Rides the daily tick; the
 * manager's "Sync now" button calls `syncSiteFeedbackIssues` directly.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import {
  getGithubConfig,
  getIssueStates,
} from "#/features/site-feedback/server/github.server";
import type { GithubConfig } from "#/features/site-feedback/server/github.server";
import { getDb, inJsonArray, runBatch, schema } from "#/server/db";
import { errorMessage, log } from "#/server/log/log.server";

export interface SiteFeedbackSyncResult {
  checked: number;
  closed: number;
}

/** One sync pass. Throws on a GitHub or database failure. */
export async function syncSiteFeedbackIssues(
  cfg: GithubConfig,
): Promise<SiteFeedbackSyncResult> {
  const db = getDb();
  const open = await db
    .select({
      id: schema.siteFeedbackIssues.id,
      githubNumber: schema.siteFeedbackIssues.githubNumber,
    })
    .from(schema.siteFeedbackIssues)
    .where(
      and(
        eq(schema.siteFeedbackIssues.state, "open"),
        isNotNull(schema.siteFeedbackIssues.githubNumber),
      ),
    );
  const tracked = open.flatMap((row) =>
    row.githubNumber === null ? [] : [{ id: row.id, number: row.githubNumber }],
  );
  if (tracked.length === 0) {
    return { checked: 0, closed: 0 };
  }

  const states = await getIssueStates(
    cfg,
    tracked.map((t) => t.number),
  );
  const now = Temporal.Now.instant();
  const closedIds = tracked
    .filter((t) => (states.get(t.number) ?? "closed") === "closed")
    .map((t) => t.id);
  const openIds = tracked
    .filter((t) => (states.get(t.number) ?? "closed") === "open")
    .map((t) => t.id);
  // Two set-based statements, each binding a constant number of parameters
  // (the id list is one JSON parameter), in one atomic batch.
  const write = (state: "open" | "closed", ids: readonly string[]) =>
    db
      .update(schema.siteFeedbackIssues)
      .set({ state, githubSyncedAt: now })
      .where(inJsonArray(schema.siteFeedbackIssues.id, ids));
  await runBatch([
    ...(closedIds.length > 0 ? [write("closed", closedIds)] : []),
    ...(openIds.length > 0 ? [write("open", openIds)] : []),
  ]);
  return { checked: tracked.length, closed: closedIds.length };
}

/**
 * The cron entry point. Null when GitHub isn't configured or the pass
 * failed; it never rejects into the daily tick.
 */
export async function runSiteFeedbackIssueSync(): Promise<SiteFeedbackSyncResult | null> {
  try {
    const cfg = getGithubConfig();
    if (cfg === null) {
      return null;
    }
    return await syncSiteFeedbackIssues(cfg);
  } catch (err) {
    log.error("site_feedback.sync_failed", { error: errorMessage(err) });
    return null;
  }
}

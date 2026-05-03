/**
 * Daily retention sweeps run by the worker's `scheduled` handler.
 * Closes the four promises the privacy notice makes:
 *
 *   - rejected registrations purged 30 days after rejection
 *   - deactivated accounts purged 12 months after deactivation
 *   - revoked waiver attestations dropped 90 days after revocation
 *   - R2 objects (avatars + landing images) not referenced by any DB
 *     row are deleted from the bucket
 *
 * NULL-skip discipline: rows whose timestamp column is NULL are
 * deliberately ignored. `rejected_at` / `deactivated_at` were added in
 * migration 0019, so historical rejections / deactivations don't have
 * a known transition date — we don't auto-purge them retroactively.
 * An admin can clean those up manually, or future re-rejections will
 * stamp the column and the next sweep will pick them up.
 *
 * All four sweeps are independent — failure of one (e.g. R2 down)
 * doesn't prevent the others from running. The orchestrator
 * `runRetentionSweeps()` runs them sequentially and aggregates a
 * structured result that the scheduled handler logs.
 */
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { getBucket } from "#/server/r2";

const DAY_MS = 24 * 60 * 60 * 1000;

const REJECTED_RETENTION_DAYS = 30;
const DEACTIVATED_RETENTION_DAYS = 365;
const REVOKED_WAIVER_RETENTION_DAYS = 90;

// R2 prefixes the cron is allowed to GC. Any object outside these
// prefixes (e.g. a future `static/` bucket layout) is left alone.
const GC_PREFIXES = ["avatars/", "landing/"] as const;

// Settings keys whose JSON value is an R2 image key. `landingSettings`
// is a singleton key/value store; the about + meeting sections store
// their image as `value_json: JSON.stringify("landing/about/abc.webp")`.
const SETTINGS_IMAGE_KEYS = ["about.image_key", "meeting.image_key"];

export interface SweepCounts {
  rejectedRegistrations: number;
  deactivatedAccounts: number;
  revokedWaivers: number;
  orphanR2Keys: number;
}

export async function sweepRejectedRegistrations(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - REJECTED_RETENTION_DAYS * DAY_MS);
  const deleted = await getDb()
    .delete(schema.users)
    .where(
      and(
        eq(schema.users.status, "rejected"),
        isNotNull(schema.users.rejectedAt),
        lt(schema.users.rejectedAt, cutoff),
      ),
    )
    .returning({ id: schema.users.id });
  return deleted.length;
}

export async function sweepDeactivatedAccounts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DEACTIVATED_RETENTION_DAYS * DAY_MS);
  const deleted = await getDb()
    .delete(schema.users)
    .where(
      and(
        eq(schema.users.status, "deactivated"),
        isNotNull(schema.users.deactivatedAt),
        lt(schema.users.deactivatedAt, cutoff),
      ),
    )
    .returning({ id: schema.users.id });
  return deleted.length;
}

export async function sweepRevokedWaiverAttestations(
  now: Date,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - REVOKED_WAIVER_RETENTION_DAYS * DAY_MS,
  );
  const deleted = await getDb()
    .delete(schema.waiverAttestations)
    .where(
      and(
        isNotNull(schema.waiverAttestations.revokedAt),
        lt(schema.waiverAttestations.revokedAt, cutoff),
      ),
    )
    .returning({ id: schema.waiverAttestations.id });
  return deleted.length;
}

/**
 * Walks every R2 object under the GC prefixes, builds the set of keys
 * still referenced by D1, and deletes anything outside that set.
 *
 * Pagination via `cursor` so we don't materialize the entire bucket
 * in memory; the live-keys set IS held in memory but it's a cap of
 * (member count + landing slides + activities + ~2 settings rows),
 * which is bounded by how many users the club has ever had.
 */
export async function sweepOrphanR2Keys(): Promise<number> {
  const liveKeys = await loadReferencedR2Keys();
  const bucket = getBucket();

  let deleted = 0;
  for (const prefix of GC_PREFIXES) {
    let cursor: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      const orphans = page.objects
        .map((o) => o.key)
        .filter((key) => !liveKeys.has(key));

      if (orphans.length > 0) {
        // R2's delete() accepts a string array up to 1000 keys.
        await bucket.delete(orphans);
        deleted += orphans.length;
      }

      truncated = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    }
  }
  return deleted;
}

async function loadReferencedR2Keys(): Promise<Set<string>> {
  const db = getDb();
  const live = new Set<string>();

  const avatars = await db
    .select({ key: schema.profiles.avatarKey })
    .from(schema.profiles)
    .where(isNotNull(schema.profiles.avatarKey));
  for (const row of avatars) {
    if (row.key) {
      live.add(row.key);
    }
  }

  const heroes = await db
    .select({ key: schema.landingHeroSlides.imageKey })
    .from(schema.landingHeroSlides);
  for (const row of heroes) {
    live.add(row.key);
  }

  const activities = await db
    .select({ key: schema.landingActivities.imageKey })
    .from(schema.landingActivities)
    .where(isNotNull(schema.landingActivities.imageKey));
  for (const row of activities) {
    if (row.key) {
      live.add(row.key);
    }
  }

  const settings = await db
    .select({
      key: schema.landingSettings.key,
      valueJson: schema.landingSettings.valueJson,
    })
    .from(schema.landingSettings)
    .where(inArray(schema.landingSettings.key, SETTINGS_IMAGE_KEYS));
  for (const row of settings) {
    // valueJson is the JSON-encoded image key (`"landing/about/abc.webp"`)
    // or the JSON-encoded null for "no image set". Tolerate both shapes
    // and any malformed JSON (skip the row rather than fail the sweep —
    // the orphan GC is best-effort).
    try {
      const parsed: unknown = JSON.parse(row.valueJson);
      if (typeof parsed === "string" && parsed.length > 0) {
        live.add(parsed);
      }
    } catch {
      // Not valid JSON — leave as-is, the GC sweep skips this row.
    }
  }

  return live;
}

export async function runRetentionSweeps(
  now: Date = new Date(),
): Promise<SweepCounts> {
  const counts: SweepCounts = {
    rejectedRegistrations: 0,
    deactivatedAccounts: 0,
    revokedWaivers: 0,
    orphanR2Keys: 0,
  };

  // Each sweep is wrapped so an error in one (e.g. R2 outage) doesn't
  // sink the others. Errors are logged with structured context for the
  // Workers Logs panel.
  const sweeps: Array<{
    name: keyof SweepCounts;
    run: () => Promise<number>;
  }> = [
    {
      name: "rejectedRegistrations",
      run: () => sweepRejectedRegistrations(now),
    },
    { name: "deactivatedAccounts", run: () => sweepDeactivatedAccounts(now) },
    { name: "revokedWaivers", run: () => sweepRevokedWaiverAttestations(now) },
    { name: "orphanR2Keys", run: () => sweepOrphanR2Keys() },
  ];

  for (const sweep of sweeps) {
    try {
      counts[sweep.name] = await sweep.run();
    } catch (err) {
      // Structured log goes to Workers Logs (Cloudflare dashboard,
      // ~7d retention). The cron has no UI; logs are the only signal.
      // eslint-disable-next-line no-console
      console.error("retention.sweep_failed", {
        sweep: sweep.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("retention.sweeps_complete", counts);
  return counts;
}

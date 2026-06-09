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
import { getPublicBucket } from "#/server/r2";

const DAY_MS = 24 * 60 * 60 * 1000;

const REJECTED_RETENTION_DAYS = 30;
const DEACTIVATED_RETENTION_DAYS = 365;
const REVOKED_WAIVER_RETENTION_DAYS = 90;

// Skip orphan-GC for any R2 object uploaded in the last 5 minutes.
// Avatars are uploaded in two steps (PUT R2, then UPDATE D1); a cron
// pass that snapshots both the bucket and the DB while a member's
// upload is in flight could otherwise treat the freshly-PUT R2 key
// as orphan and clip it. 5 minutes is many orders of magnitude longer
// than any plausible PUT→UPDATE gap, so a real upload is never within
// the skip window. Any genuine orphan younger than 5 minutes simply
// gets picked up on the next day's sweep — never lost, just delayed.
const DEFAULT_MIN_ORPHAN_AGE_MS = 5 * 60 * 1000;

// R2's batch-delete API accepts up to 1000 keys per call.
const R2_BATCH_DELETE_LIMIT = 1000;

// R2 prefixes the cron is allowed to GC. Any object outside these
// prefixes (e.g. a future `static/` bucket layout) is left alone.
const GC_PREFIXES = ["avatars/", "landing/", "gazette/", "gallery/"] as const;

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

export async function sweepRejectedRegistrations(
  now: Temporal.Instant,
): Promise<number> {
  const cutoff = now.subtract({
    milliseconds: REJECTED_RETENTION_DAYS * DAY_MS,
  });
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

export async function sweepDeactivatedAccounts(
  now: Temporal.Instant,
): Promise<number> {
  const cutoff = now.subtract({
    milliseconds: DEACTIVATED_RETENTION_DAYS * DAY_MS,
  });
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
  now: Temporal.Instant,
): Promise<number> {
  const cutoff = now.subtract({
    milliseconds: REVOKED_WAIVER_RETENTION_DAYS * DAY_MS,
  });
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
 * Snapshots the bucket and the DB live-key set, then deletes any R2
 * object that's (a) not referenced by any DB row AND (b) older than
 * `minOrphanAgeMs`.
 *
 * **Race-safety design.** Avatar / landing-image uploads do PUT R2
 * first, then UPDATE D1 — there's a sub-second window where the new
 * R2 key exists but no DB row references it yet. A naive "DB-then-R2"
 * cron could mistake an in-flight upload for an orphan. Two
 * mitigations together make this impossible:
 *
 *   1. **R2-first ordering.** List the bucket fully, *then* read the
 *      DB live set. A new key uploaded after the R2 list isn't in our
 *      snapshot, so we never consider it. A key uploaded before the
 *      list with its UPDATE happening before the DB read shows up in
 *      both — kept correctly.
 *
 *   2. **Age guard.** Skip any object whose `uploaded` timestamp is
 *      within the last `minOrphanAgeMs`. Even if the cron runs slow,
 *      the PUT-to-UPDATE gap (sub-second in practice) can never
 *      exceed five minutes.
 *
 * Memory: collects all R2 keys + the DB live set in memory. Bounded
 * by club membership + landing assets — a few hundred KB at worst.
 */
export async function sweepOrphanR2Keys(
  now: Temporal.Instant = Temporal.Now.instant(),
  minOrphanAgeMs: number = DEFAULT_MIN_ORPHAN_AGE_MS,
): Promise<number> {
  const bucket = getPublicBucket();

  // 1. List every key under the GC prefixes BEFORE reading the DB.
  const r2Objects: R2Object[] = [];
  for (const prefix of GC_PREFIXES) {
    let cursor: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await bucket.list({
        prefix,
        cursor,
        limit: R2_BATCH_DELETE_LIMIT,
      });
      r2Objects.push(...page.objects);
      truncated = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    }
  }

  // 2. Read the DB live set after R2 listing, so any key visible in
  //    R2 has either also landed in DB (no-op) or is too new for the
  //    age guard (skipped).
  const liveKeys = await loadReferencedR2Keys();
  // R2 `object.uploaded` is a native Date (R2 API), so the age guard stays
  // in epoch-ms space rather than mixing Instant comparisons.
  const ageCutoffMs = now.epochMilliseconds - minOrphanAgeMs;

  const orphans: string[] = [];
  for (const object of r2Objects) {
    if (liveKeys.has(object.key)) {
      continue;
    }
    if (object.uploaded.getTime() >= ageCutoffMs) {
      // Skip — within the upload-race window. Next sweep picks it up
      // if it's still unreferenced then.
      continue;
    }
    orphans.push(object.key);
  }

  // 3. Batch-delete in chunks of 1000 (R2's API limit).
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += R2_BATCH_DELETE_LIMIT) {
    const batch = orphans.slice(i, i + R2_BATCH_DELETE_LIMIT);
    await bucket.delete(batch);
    deleted += batch.length;
  }
  return deleted;
}

async function loadReferencedR2Keys(): Promise<Set<string>> {
  const db = getDb();
  const live = new Set<string>();

  // Five independent reads against five separate tables — bundle into
  // one `db.batch` so the cron's D1 wait is a single HTTP request.
  // Order doesn't matter; everything funnels into the same Set.
  const [avatars, heroes, activities, settings, gazette, gallery] =
    await db.batch([
      db
        .select({ key: schema.profiles.avatarKey })
        .from(schema.profiles)
        .where(isNotNull(schema.profiles.avatarKey)),
      db
        .select({ key: schema.landingHeroSlides.imageKey })
        .from(schema.landingHeroSlides),
      db
        .select({ key: schema.landingActivities.imageKey })
        .from(schema.landingActivities)
        .where(isNotNull(schema.landingActivities.imageKey)),
      db
        .select({
          key: schema.landingSettings.key,
          valueJson: schema.landingSettings.valueJson,
        })
        .from(schema.landingSettings)
        .where(inArray(schema.landingSettings.key, SETTINGS_IMAGE_KEYS)),
      db
        .select({ key: schema.gazetteIssues.pdfKey })
        .from(schema.gazetteIssues),
      db
        .select({ key: schema.galleryPhotos.imageKey })
        .from(schema.galleryPhotos),
    ]);

  for (const row of avatars) {
    if (row.key) {
      live.add(row.key);
    }
  }
  for (const row of heroes) {
    live.add(row.key);
  }
  for (const row of activities) {
    if (row.key) {
      live.add(row.key);
    }
  }
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
  for (const row of gazette) {
    live.add(row.key);
  }
  for (const row of gallery) {
    live.add(row.key);
  }

  return live;
}

export interface RunRetentionSweepsOptions {
  /**
   * Override for the orphan-GC age guard (default: 5 minutes). The
   * scheduled handler in production never sets this — only tests
   * pass `0` so freshly-uploaded fixture objects don't fall into the
   * upload-race skip window.
   */
  minOrphanAgeMs?: number;
}

export async function runRetentionSweeps(
  now: Temporal.Instant = Temporal.Now.instant(),
  options: RunRetentionSweepsOptions = {},
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
    {
      name: "orphanR2Keys",
      run: () => sweepOrphanR2Keys(now, options.minOrphanAgeMs),
    },
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

#!/usr/bin/env tsx
/**
 * One-shot copy of every avatar + landing image from the private R2
 * bucket to the public R2 bucket.
 *
 * Why this exists: PR `feat/r2-public-binding` switches both
 * `getAvatar*` and `getLandingImage*` callers from `getPrivateBucket()`
 * to `getPublicBucket()`. Without copying the existing objects, every
 * already-uploaded avatar / landing image would 404 from the new CDN
 * domain — only NEW uploads would land in the public bucket.
 *
 * What it copies:
 *   1. `profiles.avatar_key` (every non-null avatar)
 *   2. `landing_hero_slides.image_key` (every hero slide)
 *   3. `landing_activities.image_key` (every non-null activity image)
 *   4. `landing_settings.value_json` for the JSON-encoded keys
 *      `about.image_key` and `meeting.image_key`
 *
 * What it does NOT do:
 *   - Delete originals from the private bucket. PR 2c handles cleanup
 *     after a deploy cycle of stable reads from the public bucket.
 *   - Mirror unreferenced (orphaned) objects. The retention sweep would
 *     have GC'd those anyway, and copying them across just to delete
 *     them later wastes bytes.
 *
 * Idempotent: each `wrangler r2 object put` is content-hash-keyed, so
 * a second run rewrites the same bytes to the same keys. Safe to retry
 * on failure.
 *
 * Usage:
 *   pnpm --filter ucmc-web exec tsx scripts/migrate-r2-to-public.ts --env dev
 *   pnpm --filter ucmc-web exec tsx scripts/migrate-r2-to-public.ts --env prod
 *
 * Auth: relies on the standard wrangler auth chain (CLOUDFLARE_API_TOKEN
 * env var, or `wrangler login`). Token must have R2 read on the private
 * bucket, R2 write on the public bucket, and D1 read on the env's
 * database.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvKey = "dev" | "prod";

interface EnvConfig {
  d1Database: string;
  privateBucket: string;
  publicBucket: string;
  /** Extra args appended to every wrangler invocation. */
  wranglerEnvFlag: readonly string[];
}

const CONFIGS: Record<EnvKey, EnvConfig> = {
  dev: {
    d1Database: "ucmc-web-dev",
    privateBucket: "ucmc-web-dev-storage",
    publicBucket: "ucmc-web-dev-public-storage",
    wranglerEnvFlag: [],
  },
  prod: {
    d1Database: "ucmc-web",
    privateBucket: "ucmc-web-storage",
    publicBucket: "ucmc-web-public-storage",
    wranglerEnvFlag: ["--env", "production"],
  },
};

function parseArgs(): { env: EnvKey } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--env");
  if (idx === -1 || idx === args.length - 1) {
    throw new Error("Usage: tsx migrate-r2-to-public.ts --env <dev|prod>");
  }
  const env = args[idx + 1];
  if (env !== "dev" && env !== "prod") {
    throw new Error("--env must be 'dev' or 'prod'");
  }
  return { env };
}

function contentTypeFor(key: string): string {
  if (key.endsWith(".webp")) {
    return "image/webp";
  }
  if (key.endsWith(".png")) {
    return "image/png";
  }
  return "image/jpeg";
}

/**
 * Run a SQL query against the env's D1 database in JSON output mode and
 * return the parsed rows. `wrangler d1 execute --json` returns a single
 * envelope `[{ results: [...] }]` per statement.
 */
function queryD1<TRow>(env: EnvConfig, sql: string): TRow[] {
  const out = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      ...env.wranglerEnvFlag,
      "d1",
      "execute",
      env.d1Database,
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const parsed = JSON.parse(out) as Array<{ results?: TRow[] }>;
  return parsed[0]?.results ?? [];
}

function collectKeys(env: EnvConfig): string[] {
  const live = new Set<string>();

  for (const row of queryD1<{ key: string | null }>(
    env,
    `SELECT avatar_key AS key FROM profiles WHERE avatar_key IS NOT NULL`,
  )) {
    if (row.key) {
      live.add(row.key);
    }
  }

  for (const row of queryD1<{ key: string }>(
    env,
    `SELECT image_key AS key FROM landing_hero_slides`,
  )) {
    if (row.key) {
      live.add(row.key);
    }
  }

  for (const row of queryD1<{ key: string | null }>(
    env,
    `SELECT image_key AS key FROM landing_activities WHERE image_key IS NOT NULL`,
  )) {
    if (row.key) {
      live.add(row.key);
    }
  }

  // landing_settings stores about+meeting image keys as JSON strings
  // (e.g. value_json = '"landing/about/abc.webp"'). Decode each row.
  for (const row of queryD1<{ key: string; value_json: string }>(
    env,
    `SELECT key, value_json FROM landing_settings WHERE key IN ('about.image_key', 'meeting.image_key')`,
  )) {
    try {
      const parsed: unknown = JSON.parse(row.value_json);
      if (typeof parsed === "string" && parsed.length > 0) {
        live.add(parsed);
      }
    } catch {
      // Setting row exists but is malformed JSON — skip; the live app
      // would already be misrendering, not the migrator's job to fix.
    }
  }

  return Array.from(live).sort();
}

function copyOne(env: EnvConfig, key: string, scratchDir: string): void {
  const tmpFile = join(scratchDir, "object.bin");

  // GET from private bucket → temp file. `wrangler r2 object get` writes
  // the body to --file (or stdout). Use --file to avoid stdio buffering
  // issues on large objects.
  const getResult = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      ...env.wranglerEnvFlag,
      "r2",
      "object",
      "get",
      `${env.privateBucket}/${key}`,
      "--remote",
      "--file",
      tmpFile,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (getResult.status !== 0) {
    throw new Error(`r2 get ${env.privateBucket}/${key} failed`);
  }

  // PUT to public bucket with content-type and Cache-Control set on the
  // object metadata (R2 custom domains pass these through; setting at
  // upload time is the canonical fix).
  const putResult = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      ...env.wranglerEnvFlag,
      "r2",
      "object",
      "put",
      `${env.publicBucket}/${key}`,
      "--remote",
      "--file",
      tmpFile,
      "--content-type",
      contentTypeFor(key),
      "--cache-control",
      "public, max-age=31536000, immutable",
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (putResult.status !== 0) {
    throw new Error(`r2 put ${env.publicBucket}/${key} failed`);
  }
}

async function main(): Promise<void> {
  const { env } = parseArgs();
  const config = CONFIGS[env];

  console.log(
    `[migrate-r2-to-public] target env=${env} private=${config.privateBucket} public=${config.publicBucket}`,
  );

  console.log("[migrate-r2-to-public] reading live R2 keys from D1…");
  const keys = collectKeys(config);
  console.log(`[migrate-r2-to-public] found ${keys.length} key(s) to copy`);
  if (keys.length === 0) {
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), "ucmc-r2-migrate-"));
  let copied = 0;
  let failed = 0;
  try {
    for (const key of keys) {
      const label = `${copied + failed + 1}/${keys.length}`;
      try {
        process.stdout.write(`[${label}] ${key} … `);
        copyOne(config, key, scratch);
        copied += 1;
        console.log("ok");
      } catch (err) {
        failed += 1;
        console.log(`FAILED (${(err as Error).message})`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`[migrate-r2-to-public] done. copied=${copied} failed=${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();

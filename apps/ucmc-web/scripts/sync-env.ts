#!/usr/bin/env tsx
/**
 * Points `wrangler.jsonc` at one Pulumi stack, before a deploy builds it
 * (#312). Replaces the `sed` over placeholder UUIDs: this knows which
 * value goes where, and fails on anything it doesn't (`wrangler-env.ts`).
 *
 *   pulumi stack output --json --stack dev > outputs.json
 *   pnpm --filter ucmc-web sync-env --stack dev --outputs outputs.json
 *   pnpm --filter ucmc-web sync-env --stack prod --outputs prod.json --dry-run
 *
 * Run in CI's throwaway checkout, BEFORE `pnpm build`:
 * `@cloudflare/vite-plugin` snapshots this file into
 * `dist/server/wrangler.json`, and every later `wrangler` command reads
 * that snapshot, not the source. Never commit the result.
 *
 * Secrets are not this script's job; the deploy action writes them to a
 * `--secrets-file`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  parseStack,
  parseStackOutputs,
  SyncError,
  syncWranglerConfig,
} from "./wrangler-env";

const { values } = parseArgs({
  options: {
    stack: { type: "string" },
    outputs: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const configPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "wrangler.jsonc",
);

try {
  if (!values.outputs) {
    throw new SyncError(
      "Usage: sync-env --stack <dev|prod> --outputs <pulumi stack output --json file> [--dry-run]",
    );
  }
  const stack = parseStack(values.stack);
  const outputs = parseStackOutputs(
    JSON.parse(readFileSync(values.outputs, "utf8")),
  );
  const synced = syncWranglerConfig(
    readFileSync(configPath, "utf8"),
    stack,
    outputs,
  );
  if (values["dry-run"]) {
    console.log(synced);
  } else {
    writeFileSync(configPath, synced);
    console.log(`sync-env: wrangler.jsonc → ${outputs.workerNameOutput}`);
  }
} catch (err) {
  console.error(err instanceof SyncError ? `sync-env: ${err.message}` : err);
  process.exit(1);
}

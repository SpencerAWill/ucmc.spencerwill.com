#!/usr/bin/env tsx
/**
 * Fails when the build is over its size budget (#190).
 *
 *   pnpm --filter ucmc-web build && pnpm --filter ucmc-web size
 *
 * Two halves, both against what `vite build` left in `dist/`:
 *
 *   - Client: reads `dist/client/.vite/manifest.json` (written because
 *     `vite.config.ts` turns `build.manifest` on for the client environment;
 *     `public/.assetsignore` keeps it out of the deployed assets), gzips
 *     every JS chunk, and checks the initial set, the entry, and every other
 *     chunk against `bundle-budget.ts`. A failure prints each offending chunk
 *     with its size, its budget and the delta.
 *   - Worker: asks `wrangler deploy --dry-run` for its upload totals, as
 *     flareling's `check-worker-size.ts` does, and checks Workers' 64 MiB
 *     limit and the gzip budget. If Wrangler's output changes and the totals
 *     can't be found, this fails rather than passing.
 *
 * Both halves always run, so one failure doesn't hide the other.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { CLIENT_BUDGET, WORKER_GZIP_BUDGET_KIB } from "./bundle-budget";
import {
  ambiguousExemptions,
  BundleSizeError,
  checkClientBudget,
  measureChunks,
  parseWranglerTotals,
  staleExemptions,
} from "./bundle-size";
import type { Manifest } from "./bundle-size";

const CLIENT_DIR = "dist/client";
const MANIFEST = join(CLIENT_DIR, ".vite/manifest.json");
const WORKER_LIMIT_KIB = 64 * 1024;

const summary: string[] = [];
const fmt = (n: number) => n.toFixed(1);

function checkClient(): boolean {
  if (!existsSync(MANIFEST)) {
    console.error(`${MANIFEST} not found. Run \`pnpm build\` first.`);
    return false;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const chunks = (() => {
    try {
      return measureChunks(
        manifest,
        (file) => gzipSync(readFileSync(join(CLIENT_DIR, file))).length / 1000,
      );
    } catch (error) {
      // Reported here rather than thrown, so the Worker half still runs.
      if (error instanceof BundleSizeError) {
        console.error(error.message);
        return null;
      }
      throw error;
    }
  })();
  if (!chunks) {
    return false;
  }

  const entryKb = chunks
    .filter((chunk) => chunk.isEntry)
    .reduce((sum, chunk) => sum + chunk.gzipKb, 0);
  const initial = chunks.filter((chunk) => chunk.isInitial);
  const initialKb = initial.reduce((sum, chunk) => sum + chunk.gzipKb, 0);
  const largest = chunks
    .filter(
      (chunk) =>
        !chunk.isEntry && !CLIENT_BUDGET.lazyExemptions.includes(chunk.name),
    )
    .reduce<(typeof chunks)[number] | undefined>(
      (a, b) => (a === undefined || b.gzipKb > a.gzipKb ? b : a),
      undefined,
    );
  summary.push(
    `client initial JS: ${fmt(initialKb)} kB gzip in ${initial.length} chunks (budget ${CLIENT_BUDGET.initialGzipKb})`,
    `client entry: ${fmt(entryKb)} kB gzip (budget ${CLIENT_BUDGET.entryGzipKb})`,
  );
  if (largest) {
    summary.push(
      `client largest non-entry chunk: ${largest.name} (${largest.file}), ${fmt(largest.gzipKb)} kB gzip (budget ${CLIENT_BUDGET.chunkGzipKb})`,
    );
  }

  const violations = checkClientBudget(chunks, CLIENT_BUDGET);
  const stale = staleExemptions(chunks, CLIENT_BUDGET);
  const ambiguous = ambiguousExemptions(chunks, CLIENT_BUDGET);
  if (violations.length > 0) {
    console.error("Client bundle is over budget:");
    console.table(
      violations.map((v) => ({
        check: v.check,
        chunk: v.chunk,
        file: v.file,
        "gzip kB": fmt(v.sizeKb),
        "budget kB": fmt(v.budgetKb),
        delta: `+${fmt(v.sizeKb - v.budgetKb)}`,
      })),
    );
  }
  for (const name of stale) {
    console.error(
      `lazyExemptions lists "${name}", which matches no chunk. Remove it or fix the name.`,
    );
  }
  for (const name of ambiguous) {
    console.error(
      `lazyExemptions lists "${name}", which names more than one chunk, so it would exempt all of them. Give the lazy chunk a unique name.`,
    );
  }
  return (
    violations.length === 0 && stale.length === 0 && ambiguous.length === 0
  );
}

function checkWorker(): boolean {
  const outdir = mkdtempSync(join(tmpdir(), "worker-size-"));
  const result = spawnSync(
    "wrangler",
    ["deploy", "--dry-run", "--outdir", outdir],
    {
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  rmSync(outdir, { recursive: true, force: true });

  const output = `${result.stdout}${result.stderr}`;
  if (result.error) {
    console.error(`Could not run wrangler: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(output);
    console.error(`wrangler deploy --dry-run exited with ${result.status}`);
    return false;
  }
  const totals = parseWranglerTotals(output);
  if (!totals) {
    console.error(output);
    console.error(
      "Could not find Wrangler's 'Total Upload' line in its output.",
    );
    return false;
  }

  summary.push(
    `worker: ${fmt(totals.gzipKib)} KiB gzip, ${fmt(totals.rawKib)} KiB raw (budget ${WORKER_GZIP_BUDGET_KIB} KiB gzip)`,
  );
  if (totals.rawKib > WORKER_LIMIT_KIB) {
    console.error("The Worker is over Workers' 64 MiB uncompressed limit.");
    return false;
  }
  if (totals.gzipKib > WORKER_GZIP_BUDGET_KIB) {
    console.error(
      `The Worker is over its gzip budget by ${fmt(totals.gzipKib - WORKER_GZIP_BUDGET_KIB)} KiB.`,
    );
    return false;
  }
  return true;
}

const clientOk = checkClient();
const workerOk = checkWorker();

for (const line of summary) {
  console.log(line);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Bundle size\n\n${summary.map((line) => `- ${line}`).join("\n")}\n`,
  );
}
if (!clientOk || !workerOk) {
  process.exit(1);
}

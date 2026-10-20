#!/usr/bin/env tsx
/**
 * Fails when `drizzle/schema.ts` has changes no migration covers (#318).
 *
 *   pnpm --filter ucmc-web db:drift
 *
 * Runs `drizzle-kit generate` against a throwaway COPY of the migrations
 * folder and fails if it wrote anything. The working tree is never touched:
 * on a failure, run `db:generate` (or `db:generate --custom`) yourself and
 * review what it writes.
 *
 * What this guards is the snapshot chain in `meta/`, which `generate` diffs
 * against. It fell behind unnoticed (0060–0083 have no snapshots),
 * `generate` read the gap as a set of table renames and blocked on a TTY
 * prompt, and every migration in that range was written by hand.
 * `0084_snapshot.json` restarted the chain; this keeps it from breaking
 * again. A migration that bypasses `generate` leaves the
 * newest snapshot behind `schema.ts`, and the next run here says so.
 *
 * It is NOT the check that the migrated database matches `schema.ts` —
 * that's `src/server/__tests__/schema-drift.test.ts`, which asks the
 * database itself. The two disagree on purpose in two places, both of which
 * the snapshot records as `schema.ts` says, so neither ever becomes DDL:
 *   - `users.public_id` is NOT NULL here, nullable in D1, enforced by
 *     triggers (`0071`; the test's KNOWN_NULLABILITY_DRIFT explains why
 *     the table can't be rebuilt).
 *   - `roles.display_name` has `DEFAULT ''` in D1 (`ALTER TABLE ADD
 *     COLUMN … NOT NULL` needs one) and none in `schema.ts`, whose insert
 *     type requires the value anyway.
 * FTS5 virtual tables and their triggers (`0081`) are invisible to Drizzle.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import config from "../drizzle.config";

function fingerprint(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, entry.toString());
    if (statSync(path).isFile()) {
      files.set(
        relative(dir, path),
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      );
    }
  }
  return files;
}

if (typeof config.schema !== "string" || config.out === undefined) {
  throw new Error("drizzle.config.ts must set `schema` (one path) and `out`");
}

const scratch = mkdtempSync(join(tmpdir(), "ucmc-migration-drift-"));
try {
  const copy = join(scratch, "migrations");
  cpSync(config.out, copy, { recursive: true });
  const before = fingerprint(copy);

  // `--out` stays relative: drizzle-kit prefixes `./` when it reads the
  // existing snapshots back, so an absolute path reads as no snapshots and
  // every run would report the whole schema as new.
  const result = spawnSync(
    "drizzle-kit",
    [
      "generate",
      "--dialect",
      config.dialect,
      "--schema",
      config.schema,
      "--out",
      relative(process.cwd(), copy),
    ],
    // No stdin, so a change generate would ask about (is this column a
    // rename?) fails here rather than hanging CI.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // ...but drizzle-kit 0.31 catches that failure, prints the stack to
  // stderr and exits 0, writing nothing, which would read as "no drift".
  // A clean run writes nothing to stderr, so anything there is a failure.
  if (result.status !== 0 || result.stderr !== "") {
    console.error(`${result.stdout}${result.stderr}`);
    console.error(
      `drizzle-kit generate failed (exit ${String(result.status)}). If it ` +
        "wanted to ask whether a change is a rename, run " +
        "`pnpm --filter ucmc-web db:generate` in a terminal and answer it.",
    );
    process.exitCode = 1;
  } else {
    report(copy, before);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function report(copy: string, before: Map<string, string>): void {
  const written = [...fingerprint(copy)]
    .filter(([file, hash]) => before.get(file) !== hash)
    .map(([file]) => file);
  if (written.length > 0) {
    console.error(
      "drizzle/schema.ts has changes that no migration covers. " +
        "drizzle-kit generate would write:\n",
    );
    for (const file of written.filter((f) => f.endsWith(".sql"))) {
      console.error(`--- ${file}\n${readFileSync(join(copy, file), "utf8")}`);
    }
    console.error(
      "Run `pnpm --filter ucmc-web db:generate --name <what_it_does>` and " +
        "review the migration (it must only add), or `db:generate --custom " +
        "--name <what_it_does>` and write the SQL by hand.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("drizzle/schema.ts and the migration snapshots agree.");
}

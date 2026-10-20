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
 * again. A migration that bypasses `generate` leaves the newest snapshot
 * behind `schema.ts`, and the next run here says so; one that changes no
 * schema (a backfill, a permission row) is caught by the journal check
 * instead — a `.sql` file and journal entry that don't pair up, or an entry
 * from 0084 on with no snapshot.
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
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../drizzle.config";

// The config's paths are relative to the package, so run from there
// whatever directory the script was invoked from.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

// The first migration `0084_snapshot.json` restarted the chain at. Every
// migration from here on has a snapshot, because `generate` (`--custom`
// included) writes one; a journal entry without one was written by hand.
const FIRST_CHAINED_MIGRATION = 84;

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

/**
 * What a schema diff can't see: a migration file or journal entry written by
 * hand. A data-only migration changes nothing in `schema.ts`, so `generate`
 * stays quiet about it, but the next `generate` then numbers from the
 * journal and collides with (or skips past) the hand-written file.
 */
function handWrittenMigrations(dir: string): string[] {
  const journal = JSON.parse(
    readFileSync(join(dir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const tags = new Set(journal.entries.map((entry) => entry.tag));
  const files = new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.slice(0, -".sql".length)),
  );
  return [
    ...[...files]
      .filter((file) => !tags.has(file))
      .map((file) => `${file}.sql has no journal entry`),
    ...[...tags]
      .filter((tag) => !files.has(tag))
      .map((tag) => `journal entry ${tag} has no .sql file`),
    ...journal.entries
      .filter(
        ({ idx, tag }) =>
          idx >= FIRST_CHAINED_MIGRATION &&
          !existsSync(join(dir, "meta", `${tag.split("_")[0]}_snapshot.json`)),
      )
      .map(({ tag }) => `${tag} has no snapshot`),
  ];
}

if (typeof config.schema !== "string" || config.out === undefined) {
  throw new Error("drizzle.config.ts must set `schema` (one path) and `out`");
}

const handWritten = handWrittenMigrations(config.out);
if (handWritten.length > 0) {
  console.error("These migrations did not come from `drizzle-kit generate`:");
  for (const line of handWritten) {
    console.error(`  - ${line}`);
  }
  console.error(
    "Recreate each with `pnpm --filter ucmc-web db:generate --custom " +
      "--name <what_it_does>` and move its SQL into the file that writes.",
  );
  process.exit(1);
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
    join("node_modules", ".bin", "drizzle-kit"),
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
    // NODE_NO_WARNINGS keeps Node's own runtime warnings (deprecations,
    // NO_COLOR vs FORCE_COLOR) off stderr, which is read as failure below.
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );
  // ...but drizzle-kit 0.31 catches that failure, prints the stack to
  // stderr and exits 0, writing nothing, which would read as "no drift".
  // A clean run writes nothing to stderr, so anything there is a failure.
  if (result.error !== undefined) {
    console.error(`Could not run drizzle-kit: ${result.error.message}`);
    process.exitCode = 1;
  } else if (result.status !== 0 || result.stderr !== "") {
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

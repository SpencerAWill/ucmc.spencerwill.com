import path from "node:path";

import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Tests run inside a real workerd runtime provided by
// @cloudflare/vitest-pool-workers — D1, KV, and the Rate Limiting binding
// are all simulated by Miniflare, so tests exercise the same code paths as
// `pnpm dev`/`wrangler deploy`.
//
// Drizzle migrations are loaded from disk once per Vitest run and passed to
// the pool as a bound array (TEST_MIGRATIONS). The setup file then calls
// `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` before each test file so
// every test gets a freshly-migrated, in-memory D1.
export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "drizzle/migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          main: "./test/worker.ts",
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Fake Worker vars for server code that reads env.* —
              // matches the shape of the production bindings but uses
              // safe test values. Keeps tests deterministic and free of
              // any dependence on .env.local.
              APP_BASE_URL: "http://localhost:3000",
              WEBAUTHN_RP_ID: "localhost",
              WEBAUTHN_RP_NAME: "UCMC (test)",
              RESEND_FROM: "test@localhost",
              RESEND_FROM_NAME: "UCMC Test",
              SESSION_SECRET: "test-session-secret-at-least-32-chars-long-xxx",
            },
            compatibilityFlags: ["nodejs_compat"],
          },
          wrangler: { configPath: "./wrangler.jsonc" },
        },
      },
    },
    resolve: {
      alias: {
        "#": path.join(import.meta.dirname, "src"),
      },
    },
  };
});

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// vitest.config.ts loads the drizzle migration SQL files from disk and
// injects them into the pool as `TEST_MIGRATIONS`. Apply them once per
// worker before the first test runs so every test sees a schema-valid
// (but empty) D1 database.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

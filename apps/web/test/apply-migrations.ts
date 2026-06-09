// workerd (the vitest workers pool runtime) has no native Temporal;
// install the polyfill before any test module touches it (mirrors the
// worker server entry).
import "temporal-polyfill/global";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// vitest.workers.config.ts loads the drizzle migration SQL files from
// disk and injects them into the pool as `TEST_MIGRATIONS`. Pool 0.16+
// isolates D1 per file (not per test), so migrations apply once per
// file and any test that writes data is responsible for cleaning up
// affected tables in its own `beforeEach`.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

import { defineConfig } from "drizzle-kit";

// Schema-only config. `drizzle-kit generate` reads `schema` and emits SQL
// migrations to `out`. `wrangler d1 migrations apply` then applies them to
// D1 (local or remote). We don't set `driver`/`dbCredentials` because we
// don't use `drizzle-kit push/migrate/studio` against remote D1.
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});

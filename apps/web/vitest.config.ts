import { defineConfig } from "vitest/config";

// Orchestrates the two Vitest projects:
//   - `vitest.workers.config.ts` runs server-side tests inside the
//     @cloudflare/vitest-pool-workers runtime (real workerd + Miniflare D1).
//   - `vitest.dom.config.ts` runs component tests in jsdom with Testing
//     Library.
// Each project owns its own setup, environment, and include glob; this file
// just lists them so `pnpm --filter ucmc-web test` covers both pools in one
// command.
export default defineConfig({
  test: {
    projects: ["./vitest.workers.config.ts", "./vitest.dom.config.ts"],
  },
});

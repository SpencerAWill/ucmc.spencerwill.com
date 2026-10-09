import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Vitest project used ONLY by Stryker (`stryker.config.json`).
 *
 * It is deliberately not listed in `vitest.config.ts`'s `projects`: the
 * files it runs are already covered by the `workers` project, and adding
 * it there would run them twice on every `pnpm test`.
 *
 * It exists because Stryker needs a runner it can restart thousands of
 * times, and the `workers` pool boots a workerd runtime and applies
 * every D1 migration per file. Mutation testing re-runs the suite once per
 * mutant; paying workerd startup for each one is the difference between
 * minutes and hours, and `@cloudflare/vitest-plugin` compatibility
 * with Stryker is unverified upstream besides.
 *
 * **Only modules that are pure may be mutated.** Anything importing
 * `cloudflare:workers` — directly or transitively through `#/server/db`
 * — cannot resolve here. That is the constraint that picks the list in
 * `stryker.config.json`, not a judgement that other modules matter less.
 */
export default defineConfig({
  test: {
    name: "mutation",
    environment: "node",
    // Temporal has no native implementation in Node either, so the
    // polyfill is installed the same way both real pools do it.
    setupFiles: ["./test/setup-mutation.ts"],
    include: [
      "src/config/__tests__/waiver-cycle.test.ts",
      "src/features/gear/lib/__tests__/scan-payload.test.ts",
      "src/features/gear/lib/__tests__/wedge-buffer.test.ts",
      "src/lib/__tests__/sanitize-filename.test.ts",
      "src/lib/__tests__/sanitize-filename.property.test.ts",
      "src/server/member-profile/__tests__/badge-rules.test.ts",
      "src/server/member-profile/__tests__/season-progress.test.ts",
      "src/server/log/__tests__/redact.test.ts",
      "src/server/log/__tests__/redact.property.test.ts",
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "#": path.join(import.meta.dirname, "src"),
    },
  },
});

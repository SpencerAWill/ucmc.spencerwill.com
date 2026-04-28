import path from "node:path";

import { defineConfig } from "vitest/config";

// Component tests run in jsdom with Testing Library. This is the second of
// two Vitest projects orchestrated by `vitest.config.ts` — the other is
// `vitest.workers.config.ts`, which runs server-side tests inside a real
// workerd runtime. Only `.test.tsx` files belong here; server `.test.ts`
// files match the workers project.
export default defineConfig({
  test: {
    name: "dom",
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.tsx"],
    setupFiles: ["./test/setup-dom.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "#": path.join(import.meta.dirname, "src"),
      // The `cloudflare:workers` synthetic module is only resolvable in the
      // workerd runtime. Some component tests transitively import server-fn
      // shells whose tree references it; stub it here so jsdom resolution
      // doesn't fail. `vite.config.ts` does the equivalent for the client
      // bundle in production.
      "cloudflare:workers": path.join(
        import.meta.dirname,
        "test/cloudflare-workers-stub.ts",
      ),
    },
  },
});

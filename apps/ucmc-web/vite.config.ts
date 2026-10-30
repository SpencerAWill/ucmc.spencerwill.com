import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * `cloudflare:workers` is a synthetic module only resolvable in the workerd
 * runtime (the SSR environment in this app). TanStack Start's RPC compiler
 * doesn't fully prune transitive server-only imports, so client bundling
 * can encounter the import and fail to resolve it. This plugin stubs it for
 * every Vite environment whose name isn't "ssr" (covers client, optimizer
 * pre-bundling, etc.). Modules that actually use `env.*` are guarded by
 * server-fn boundaries, so the stub is never executed at runtime.
 */
function stubCloudflareWorkersForClient(): Plugin {
  const VIRTUAL_ID = "\0virtual:cloudflare-workers-stub";
  return {
    name: "stub-cloudflare-workers-for-client",
    enforce: "pre",
    resolveId(source) {
      if (source !== "cloudflare:workers") {
        return null;
      }
      // Only allow the real module in the SSR/worker env.
      if (this.environment.name === "ssr") {
        return null;
      }
      return { id: VIRTUAL_ID, moduleSideEffects: false };
    },
    load(id) {
      if (id !== VIRTUAL_ID) {
        return null;
      }
      return "export const env = new Proxy({}, { get() { throw new Error('cloudflare:workers is server-only'); } });";
    },
  };
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Bind to all interfaces so the dev server is reachable from outside the
  // container (required for VS Code dev container port forwarding). `host: true`
  // is equivalent to `0.0.0.0`.
  server: {
    host: true,
    port: 3000,
    strictPort: true,
  },
  // This warning is a build-log hint, not the gate. The gate is `pnpm size`
  // (`scripts/check-bundle-size.ts`, budgets in `scripts/bundle-budget.ts`),
  // which CI runs and which fails on regression (#190). It budgets gzip;
  // this limit is raw kB. In the client build the largest chunk is the
  // entry (~1.0 MB raw, ~285 kB gzip) and the lazy Tiptap editor is ~550 kB.
  // The SSR copy of the editor is ~1.2 MB, but it ships in the Worker, which
  // `pnpm size` measures as a whole.
  build: {
    chunkSizeWarningLimit: 1200,
    sourcemap: false,
  },
  // The client manifest is what `pnpm size` walks to tell the initial load
  // from lazy chunks. `public/.assetsignore` keeps `.vite/` out of the
  // deployed assets.
  environments: {
    client: { build: { manifest: true } },
  },
  plugins: [
    devtools(),
    stubCloudflareWorkersForClient(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;

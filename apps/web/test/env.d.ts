/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Extend the `cloudflare:test` env type so `env.TEST_MIGRATIONS` and the
// Worker bindings from wrangler.jsonc are typed. Pool 0.16+ types `env`
// as `Cloudflare.Env`, so we augment the global `Cloudflare` namespace
// instead of the deprecated `ProvidedEnv` interface.
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { WorkerEnv } from "#/server/cloudflare-env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

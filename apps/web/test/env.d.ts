/// <reference types="@cloudflare/vitest-pool-workers" />

// Extend the `cloudflare:test` env type so `env.TEST_MIGRATIONS` and the
// Worker bindings from wrangler.jsonc are typed. The base ProvidedEnv is
// augmented, not replaced.
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { WorkerEnv } from "#/server/cloudflare-env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends WorkerEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}

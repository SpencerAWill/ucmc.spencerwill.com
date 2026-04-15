/**
 * Typed accessor for Cloudflare Worker bindings.
 *
 * In the @cloudflare/vite-plugin SSR runtime (workerd), bindings declared
 * in wrangler.jsonc — D1 databases, KV namespaces, vars, secrets — are
 * reachable via the `cloudflare:workers` `env` import. This module
 * re-exports it with proper types so server code never has to cast.
 */
import { env as workerEnv } from "cloudflare:workers";

export interface WorkerEnv {
  // Bindings (wrangler.jsonc)
  DB: D1Database;
  BUCKET: R2Bucket;
}

export const env = workerEnv as unknown as WorkerEnv;

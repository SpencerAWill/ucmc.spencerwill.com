/**
 * Typed accessor for the Cloudflare Worker bindings.
 *
 * In the @cloudflare/vite-plugin SSR runtime (workerd), bindings declared in
 * wrangler.jsonc — D1 databases, KV namespaces, vars, secrets — are reachable
 * via the `cloudflare:workers` `env` import. This module re-exports it with
 * proper types so server code never has to do `as any`.
 */
import { env as workerEnv } from "cloudflare:workers";

export interface WorkerEnv {
  // Bindings
  DB: D1Database;

  // Vars (wrangler.jsonc env.*.vars)
  APP_BASE_URL: string;
  RESEND_FROM: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;

  // Secrets (.dev.vars locally; `wrangler secret put` for deployed envs)
  RESEND_API_KEY?: string;
}

export const env = workerEnv as unknown as WorkerEnv;

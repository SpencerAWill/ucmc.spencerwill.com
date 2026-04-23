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
  KV: KVNamespace;
  HEALTH_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;

  // Vars — injected at deploy time from Pulumi stack outputs for dev/prod,
  // supplied via .env.local locally. See .env.example for documentation.
  APP_BASE_URL: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
  RESEND_FROM: string;
  RESEND_FROM_NAME: string;

  // Secrets — set via `wrangler secret put` in deployed envs, or .env.local
  // locally. RESEND_API_KEY is optional because the email adapter falls
  // back to console-log when unset. SESSION_SECRET is required wherever
  // the proof cookie is issued — the module that reads it throws at first
  // use, not here at module scope. TURNSTILE_SECRET_KEY is optional —
  // when unset, the sign-in form skips the challenge and Turnstile
  // verification is bypassed server-side (local dev without a widget).
  RESEND_API_KEY?: string;
  SESSION_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export const env = workerEnv as unknown as WorkerEnv;

/**
 * Typed accessor for Cloudflare Worker bindings.
 *
 * In the @cloudflare/vite-plugin SSR runtime (workerd), bindings declared
 * in wrangler.jsonc — D1 databases, KV namespaces, R2 buckets — are
 * reachable via the `cloudflare:workers` `env` import. This module
 * re-exports it with proper types so server code never has to cast.
 * Vars and secrets arrive on the same object but are typed and
 * validated by `./env.server`, not here.
 */
import { env as workerEnv } from "cloudflare:workers";

export interface WorkerEnv {
  // Bindings (wrangler.jsonc)
  DB: D1Database;
  // Private bucket — worker-mediated reads only. Default for any new
  // media. See `apps/ucmc-web/wrangler.jsonc` for the per-env bucket names.
  BUCKET_PRIVATE: R2Bucket;
  // Public bucket — bound to the `cdn.{dev.,}ucmc.spencerwill.com`
  // R2 custom domain, so reads bypass the worker entirely. Avatars
  // and landing images live here. URLs are publicly readable; the
  // app relies on content-hashed keys + opaque public IDs for
  // unguessability.
  BUCKET_PUBLIC: R2Bucket;
  KV: KVNamespace;
  // Cloudflare Images — the Album's metadata-free WebP copy. Local mode
  // (wrangler dev, the vitest pool) runs on sharp: it ignores `quality`
  // and does NOT apply EXIF orientation, so a sideways-tagged photo comes
  // out sideways there. Deployed and `--remote` are correct.
  IMAGES: ImagesBinding;
  HEALTH_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;
  UPLOAD_RATE_LIMITER: RateLimit;
  CALENDAR_RATE_LIMITER: RateLimit;
  CEREMONY_RATE_LIMITER: RateLimit;

  // Vars and secrets are NOT here: read them validated, through
  // `serverEnv()` in `./env.server` (#319). The one exception is
  // LOG_LEVEL, which the logger reads raw because it has to keep working
  // while that validation is failing.
  LOG_LEVEL?: string;
}

export const env = workerEnv as unknown as WorkerEnv;

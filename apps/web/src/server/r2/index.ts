import { env } from "#/server/cloudflare-env";

/**
 * Accessor for the R2 bucket binding.
 *
 * Unlike D1 (which needs a Drizzle client constructed around it), the R2
 * binding IS the client — `env.BUCKET` exposes `.put`, `.get`, `.head`,
 * `.list`, `.delete` directly. No singleton needed. The function wrapper
 * exists only to preserve the invariant that `env.*` is never touched at
 * module scope: TanStack Start can drag server modules into client chunks,
 * and the `cloudflare:workers` stub in vite.config.ts throws on any access
 * outside the SSR runtime.
 */
export function getBucket(): R2Bucket {
  return env.BUCKET;
}

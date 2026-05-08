import { env } from "#/server/cloudflare-env";

/**
 * Accessors for the two R2 bucket bindings.
 *
 * Unlike D1 (which needs a Drizzle client constructed around it), an R2
 * binding IS the client — it exposes `.put`, `.get`, `.head`, `.list`,
 * `.delete` directly. No singleton needed. The function wrappers exist
 * only to preserve the invariant that `env.*` is never touched at module
 * scope: TanStack Start can drag server modules into client chunks, and
 * the `cloudflare:workers` stub in vite.config.ts throws on any access
 * outside the SSR runtime.
 *
 * Choosing between buckets:
 *  - `getPrivateBucket()` — anything that should only be readable through
 *    the worker after an auth/permission check. Default for any new
 *    media. Future private uploads (waivers, internal trip reports,
 *    gear inventory photos) live here.
 *  - `getPublicBucket()` — content that's safe to expose at a Cloudflare
 *    R2 custom domain (`cdn.{dev.,}ucmc.spencerwill.com`). Reads bypass
 *    the worker entirely; bytes are publicly readable. Use only with
 *    content-hashed keys + opaque public IDs so URLs aren't enumerable.
 *    Avatars and landing images live here.
 */
export function getPrivateBucket(): R2Bucket {
  return env.BUCKET_PRIVATE;
}

export function getPublicBucket(): R2Bucket {
  return env.BUCKET_PUBLIC;
}

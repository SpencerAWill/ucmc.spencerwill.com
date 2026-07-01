import { env } from "#/server/cloudflare-env";

/**
 * Accessor for the KV namespace binding.
 *
 * KV, like R2, is its own client — `env.KV` exposes `.get`, `.put`,
 * `.delete`, `.list` directly. No singleton needed. The function wrapper
 * exists only to preserve the invariant that `env.*` is never touched at
 * module scope (see `../r2/index.ts` for the full reasoning).
 */
export function getKv(): KVNamespace {
  return env.KV;
}

/**
 * Worker-level edge cache for the anonymous home-page SSR. Wraps the
 * TanStack Start fetch handler in `apps/web/src/server-entry.ts` so
 * GET `/` requests with no auth cookies are served from
 * `caches.default` (per-PoP Workers Cache API) instead of paying the
 * ~180 ms React SSR cost on every request.
 *
 * Why only `/` for now: it's the heaviest single path in the worker
 * telemetry tail (P95 ~180 ms CPU). Other public pages
 * (/about, /membership, the legal routes) are even more static and
 * can be folded in once this validates; deferred to a follow-up so
 * the first cut has the smallest blast radius.
 *
 * Why bypass-by-cookie instead of stub-the-auth-aware-UI: most
 * `/` traffic is anonymous (recruitment surface), and anonymous SSR
 * HTML for `/` is already deterministic — UserMenu, AnnouncementsBell,
 * the auth-gated sidebar branches, and EditAffordance widgets all
 * render their public-fallback shape when `useAuth()` is anonymous.
 * Signed-in visits bypass the cache and pay full SSR (rare on `/`).
 *
 * Why not active invalidation on admin write: editor population is
 * small, edits are infrequent, and the 60 s `s-maxage` window plus
 * `stale-while-revalidate=86400` means visitors never see a stalled
 * page — they get the stale copy instantly and the next request
 * triggers a background refresh. Revisit if landing edits become
 * high-frequency.
 */

// Every cookie the project sets that signals "this is a user-specific
// request" — sessions, registration proofs, and in-flight passkey
// ceremonies. The session cookie is the only one that affects the `/`
// SSR today; the proof + webauthn names are added defensively so the
// cache key reads as "no auth state of any kind", which is easier to
// reason about than "this auth state happens not to affect `/` right now".
//
// Both `__Host-`-prefixed names (HTTPS) and bare names (HTTP local dev)
// listed because cookie helpers swap based on `APP_BASE_URL` scheme —
// see `apps/web/src/server/auth/session-cookie.server.ts` and
// `apps/web/src/features/auth/server/webauthn-ceremony.server.ts`.
const AUTH_COOKIE_NAMES: ReadonlySet<string> = new Set([
  "ucmc_session",
  "__Host-ucmc_session",
  "ucmc_proof",
  "__Host-ucmc_proof",
  "ucmc_webauthn",
  "__Host-ucmc_webauthn",
]);

/**
 * True when the request is eligible to share the anonymous home-page
 * cache entry: GET method, exact path `/`, and no auth cookies set.
 * Pure function — exported for unit tests.
 */
export function isAnonymousHomePageRequest(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  if (url.pathname !== "/") {
    return false;
  }
  return !hasAnyAuthCookie(request.headers.get("cookie"));
}

/**
 * Returns true if the cookie header contains any of the project's
 * auth cookies. Parses by name to avoid false positives where a
 * tracking cookie's *value* happens to contain a substring like
 * `ucmc_session=` — name matching only triggers on actual cookie
 * names, which appear before the `=` of each `; `-separated pair.
 */
function hasAnyAuthCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) {
    return false;
  }
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (AUTH_COOKIE_NAMES.has(part.slice(0, eq))) {
      return true;
    }
  }
  return false;
}

/**
 * Cache key that ignores query strings. Without this, `?utm_source=x`,
 * `?utm_source=y`, and `/` would each get their own cache entry — same
 * SSR output, three times the storage. The original request keeps its
 * URL so the underlying handler still sees query params for analytics.
 */
export function homePageCacheKey(request: Request): Request {
  const url = new URL(request.url);
  return new Request(`${url.origin}/`, { method: "GET" });
}

/**
 * Cloudflare Workers-style fetch handler signature
 * (`(request, env, ctx) => Response | Promise<Response>`). Mirrors
 * `ExportedHandlerFetchHandler` from `@cloudflare/workers-types`, but
 * narrowed so the wrapper composes cleanly with TanStack Start's
 * `startEntry.fetch` (which is typed `(request, opts?)` even though
 * the Cloudflare runtime always invokes it as `(request, env, ctx)`).
 */
export type WorkerFetchHandler = (
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

/**
 * Wraps a Worker fetch handler with the home-page cache layer. All
 * requests that don't satisfy `isAnonymousHomePageRequest` pass
 * through to `inner` unchanged.
 */
export function withAnonymousHomeCache(
  inner: WorkerFetchHandler,
): WorkerFetchHandler {
  return async function cachedFetch(request, env, ctx) {
    if (!isAnonymousHomePageRequest(request)) {
      return inner(request, env, ctx);
    }

    // `caches.default` is a Cloudflare extension to the standard
    // `CacheStorage` interface that the DOM lib type doesn't declare.
    // Cast through the Cloudflare-typed shape so TypeScript accepts
    // the access without losing type-safety on the resulting `Cache`.
    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = homePageCacheKey(request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await inner(request, env, ctx);

    // Belt-and-suspenders gate. Today's anonymous `/` SSR satisfies
    // all three; the checks defend against a future change silently
    // making the cache leaky (e.g. someone adds a Set-Cookie to the
    // root loader). On any miss we degrade to no-cache, not to
    // caching-a-leak.
    if (
      response.status === 200 &&
      !response.headers.has("Set-Cookie") &&
      (response.headers.get("Content-Type") ?? "").includes("text/html")
    ) {
      const toCache = response.clone();
      toCache.headers.set(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=86400",
      );
      ctx.waitUntil(cache.put(cacheKey, toCache));
    }

    return response;
  };
}

/**
 * Worker-level edge cache for anonymous public-page SSR. Wraps the
 * TanStack Start fetch handler in `apps/web/src/server-entry.ts` so
 * GET requests to a known set of public pages are served from
 * `caches.default` (per-PoP Workers Cache API) instead of paying the
 * full React SSR cost on every request.
 *
 * Why bypass-by-cookie instead of stub-the-auth-aware-UI: most public
 * traffic is anonymous (recruitment + legal-policy surfaces), and
 * anonymous SSR HTML on these pages is fully deterministic — UserMenu
 * shows "Sign in", AnnouncementsBell hidden, the auth-gated sidebar
 * branches collapsed, EditAffordance widgets render null. Signed-in
 * visits bypass the cache and pay full SSR (rare on these surfaces).
 *
 * Why these paths only: every entry in `CACHEABLE_PATHS` either has
 * no admin CMS surface at all (the legal/policy routes are constants
 * in `apps/web/src/config/legal.ts`) or has one that's edited
 * infrequently enough that the 60 s `s-maxage` window is invisible
 * (`/`, `/about`, `/membership` read landing-CMS data via the
 * `landingContentQueryOptions` query). Auth-mediated surfaces and
 * the sign-in form (Turnstile widget, CSRF) are deliberately
 * excluded.
 *
 * Why not active invalidation on admin write: editor population is
 * small, edits are infrequent, and `stale-while-revalidate=86400`
 * means visitors during the staleness window get an instant
 * response with a background revalidation. Revisit if landing
 * edits become high-frequency.
 */

// Every cookie the project sets that signals "this is a user-specific
// request" — sessions, registration proofs, and in-flight passkey
// ceremonies. Only the session cookie meaningfully affects SSR on the
// cacheable pages today; the proof + webauthn names are added
// defensively so the cache key reads as "no auth state of any kind",
// which is easier to reason about than "this auth state happens not
// to affect these pages right now".
//
// Both `__Host-`-prefixed names (HTTPS) and bare names (HTTP local
// dev) listed because cookie helpers swap based on `APP_BASE_URL`
// scheme — see `apps/web/src/server/auth/session-cookie.server.ts`
// and `apps/web/src/features/auth/server/webauthn-ceremony.server.ts`.
const AUTH_COOKIE_NAMES: ReadonlySet<string> = new Set([
  "ucmc_session",
  "__Host-ucmc_session",
  "ucmc_proof",
  "__Host-ucmc_proof",
  "ucmc_webauthn",
  "__Host-ucmc_webauthn",
]);

// Every path that should share the public-page cache. Each must:
//   1. Render the same HTML for every anonymous visitor (no per-visitor
//      randomness, locale-detection, A/B testing, etc.).
//   2. Render no Set-Cookie response header in the anonymous case
//      (the runtime gate enforces this defensively, but it's the
//      pre-condition for inclusion).
//   3. Be tolerant of a 60 s staleness window (admin edits land within
//      a minute on the 4 routes that have CMS-edited content; the
//      rest are constants in `apps/web/src/config/legal.ts`).
//
// `/sign-in` is intentionally excluded — it renders the Turnstile
// widget, which polls Cloudflare's CDN and may render differently
// per visitor, and posts a CSRF-sensitive form.
const CACHEABLE_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/about",
  "/membership",
  "/legal",
  "/disclaimer",
  "/anti-hazing",
  "/nondiscrimination",
  "/waiver",
  "/privacy",
  "/terms",
  "/open-source",
]);

/**
 * True when the request is eligible to share a public-page cache
 * entry: GET method, path is in `CACHEABLE_PATHS`, and no auth
 * cookies set. Pure function — exported for unit tests.
 */
export function isCacheablePublicPageRequest(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  if (!CACHEABLE_PATHS.has(url.pathname)) {
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
 * Cache key that strips query strings so `?utm_source=x` and
 * `?utm_source=y` share an entry — same SSR output, one cache slot.
 * The original request keeps its URL so the underlying handler still
 * sees query params for analytics.
 */
export function publicPageCacheKey(request: Request): Request {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
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
 * Wraps a Worker fetch handler with the public-page cache layer. All
 * requests that don't satisfy `isCacheablePublicPageRequest` pass
 * through to `inner` unchanged.
 */
export function withPublicPageCache(
  inner: WorkerFetchHandler,
): WorkerFetchHandler {
  return async function cachedFetch(request, env, ctx) {
    if (!isCacheablePublicPageRequest(request)) {
      return inner(request, env, ctx);
    }

    // `caches.default` is a Cloudflare extension to the standard
    // `CacheStorage` interface that the DOM lib type doesn't declare.
    // Cast through the Cloudflare-typed shape so TypeScript accepts
    // the access without losing type-safety on the resulting `Cache`.
    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = publicPageCacheKey(request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await inner(request, env, ctx);

    // Belt-and-suspenders gate. Today's anonymous SSR for every entry
    // in CACHEABLE_PATHS satisfies all three; the checks defend
    // against a future change silently making the cache leaky (e.g.
    // someone adds a Set-Cookie to a route's loader). On any miss
    // we degrade to no-cache, not to caching-a-leak.
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

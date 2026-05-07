/**
 * Sitewide security response headers. The values here are the source of
 * truth — applied via the global request middleware in `src/start.ts`
 * to every page render and server-fn response.
 *
 * Notes on the directives:
 *   - `Content-Security-Policy-Report-Only` is shipped first so the
 *     browser only logs violations (no breakage). After a few weeks of
 *     production traffic with zero violations, flip the header name to
 *     `Content-Security-Policy` to enforce.
 *   - The script/frame/connect entries for `https://challenges.cloudflare.com`
 *     are required for the Turnstile widget on the magic-link form.
 *   - `'unsafe-inline'` in script-src and style-src is required by
 *     React/Tailwind's hydration scripts and emitted style tags. A
 *     nonce-based hardening is the next step (see TanStack discussion
 *     #3028) but isn't a P0 for the registration disclaimer compliance
 *     bar.
 *   - `frame-ancestors 'none'` overlaps with X-Frame-Options DENY for
 *     defense-in-depth on older browsers.
 */
const CSP_VALUE = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  // `'unsafe-inline'` is required for React's hydration scripts and
  // for the Tailwind-emitted style tags. We deliberately do *not*
  // include `'unsafe-eval'` — the production build doesn't need it,
  // and report-only mode should mirror the eventual enforced policy
  // as closely as possible to surface real issues. If a dev-only
  // tooling chunk ever needs eval, we'll inject it via a dev-mode
  // branch rather than weakening the production policy.
  //
  // `https://challenges.cloudflare.com` covers the Turnstile widget.
  // `https://static.cloudflareinsights.com` covers Cloudflare's Web
  // Analytics beacon, which the zone auto-injects at the edge — no
  // worker-side opt-in. The matching connect-src entry below allows
  // the beacon's POSTs to `https://cloudflareinsights.com/cdn-cgi/rum`.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

/**
 * Map of header name to header value. Iterated in `start.ts` and applied
 * one at a time via `setResponseHeader` (the singular form — the plural
 * `setResponseHeaders` is a known-broken in global middleware as of
 * tanstack/router#5407).
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Content-Security-Policy-Report-Only", CSP_VALUE],
  // Pin TLS for one year, include subdomains, and signal eligibility
  // for the HSTS preload list. Cloudflare also enforces HTTPS at the
  // edge, so this is belt-and-suspenders against MITM downgrades.
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  ],
  ["X-Content-Type-Options", "nosniff"],
];

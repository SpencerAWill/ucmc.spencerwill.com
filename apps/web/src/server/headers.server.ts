/**
 * Security response headers. Mostly sitewide constants, but
 * Permissions-Policy is computed per-request so `camera` is only
 * granted on the gear-desk scanner routes (see
 * `permissionsPolicyForPath` below). The global request middleware in
 * `src/start.ts` calls `securityHeadersForPath(url.pathname)` once per
 * request and applies the returned headers via `setResponseHeader`.
 *
 * Notes on the directives:
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
  // include `'unsafe-eval'` — the production build doesn't need it.
  // If a dev-only tooling chunk ever needs eval, inject it via a
  // dev-mode branch rather than weakening the production policy.
  //
  // `https://challenges.cloudflare.com` covers the Turnstile widget.
  // `https://static.cloudflareinsights.com` covers Cloudflare's Web
  // Analytics beacon, which the zone auto-injects at the edge — no
  // worker-side opt-in. The matching connect-src entry below allows
  // the beacon's POSTs to `https://cloudflareinsights.com/cdn-cgi/rum`.
  // `'wasm-unsafe-eval'` is the surgical permission for executing
  // WebAssembly without granting full `'unsafe-eval'` (no `new Function`,
  // no `eval`). It's a hard browser requirement for the gear-scanner
  // polyfill path (Firefox + pre-17 Safari, see
  // `features/gear/components/barcode-scanner.tsx`). The native
  // BarcodeDetector path on Chrome / Edge / Android Chrome / Safari
  // 17+ doesn't actually execute any WASM, but the CSP directive
  // applies uniformly so the polyfill fallback works when needed.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

// Routes that need camera access via getUserMedia. Only the gear-desk
// checkout flow uses the rear camera (for barcode scanning), so the
// Permissions-Policy header allows camera only on those pages — every
// other route gets `camera=()`. Defense-in-depth: even if some other
// route's JS were somehow compromised, the browser would refuse the
// camera capture there.
const CAMERA_PATH_PREFIXES = ["/gear/loans"] as const;

function permissionsPolicyForPath(pathname: string): string {
  const cameraAllowed = CAMERA_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return [
    `camera=${cameraAllowed ? "(self)" : "()"}`,
    "microphone=()",
    "geolocation=()",
    "payment=()",
  ].join(", ");
}

/**
 * Compute the security headers for the current request. Pathname is
 * inspected so the Permissions-Policy can scope camera access to just
 * the gear-cave scanner routes. Everything else is static.
 *
 * Returns an array (not an object) because `start.ts` applies each
 * header via `setResponseHeader` (the singular form — the plural
 * `setResponseHeaders` is a known no-op in global middleware as of
 * tanstack/router#5407).
 */
export function securityHeadersForPath(
  pathname: string,
): ReadonlyArray<readonly [string, string]> {
  return [
    ["Content-Security-Policy", CSP_VALUE],
    // Pin TLS for one year, include subdomains, and signal eligibility
    // for the HSTS preload list. Cloudflare also enforces HTTPS at the
    // edge, so this is belt-and-suspenders against MITM downgrades.
    [
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    ],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", permissionsPolicyForPath(pathname)],
    ["X-Content-Type-Options", "nosniff"],
  ];
}

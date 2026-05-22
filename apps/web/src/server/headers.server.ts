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
  // `blob:` is required by the in-app image cropper (landing editors,
  // /gallery photo upload): `browser-image-compression` returns a Blob
  // wrapped in `URL.createObjectURL`, and `react-image-crop` displays
  // that blob URL via `<img src>`.
  "img-src 'self' data: https: blob:",
  // Same cropper path spins up a web worker from a blob URL for the
  // off-main-thread compression. `worker-src` would otherwise fall
  // back to `script-src` (which deliberately omits `blob:`), so it
  // gets its own narrow directive.
  "worker-src 'self' blob:",
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
  // `frame-src` covers the Turnstile widget AND the inline PDF
  // iframe on /gazette/$publicId.
  //
  // `'self'` is required for the local-dev fallback route at
  // `/api/gazette-pdf/$` — Miniflare doesn't expose the R2 custom
  // domain so the iframe loads same-origin in dev. CSP's `frame-src`
  // does NOT fall back to `default-src 'self'` when set, so `'self'`
  // must be listed explicitly here.
  //
  // Production loads PDFs from the R2 custom domain
  // `cdn.{dev.,}ucmc.spencerwill.com` (cross-origin from the app
  // even though same TLD); both hosts are listed unconditionally so
  // the same CSP string ships to dev + prod environments.
  "frame-src 'self' https://challenges.cloudflare.com https://cdn.ucmc.spencerwill.com https://cdn.dev.ucmc.spencerwill.com",
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
 * CSP for routes whose response is intended to be embedded by the app
 * itself via `<iframe>`. The global CSP sets `frame-ancestors 'none'`
 * and `X-Frame-Options: DENY` so no random page can frame us; that
 * blanket policy also blocks /gazette from framing its own PDFs.
 * Same-origin embedding (`frame-ancestors 'self'`) is the surgical
 * exception.
 */
const EMBEDDABLE_CSP_VALUE = [
  "default-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
].join("; ");

const EMBEDDABLE_PATH_PREFIXES = ["/api/gazette-pdf/"] as const;

function isEmbeddablePath(pathname: string): boolean {
  return EMBEDDABLE_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Compute the security headers for the current request. Pathname is
 * inspected so the Permissions-Policy can scope camera access to just
 * the gear-cave scanner routes, and so the gazette PDF route can be
 * embedded by /gazette/$publicId (the global CSP otherwise blocks any
 * iframe of it).
 *
 * Returns an array (not an object) because `start.ts` applies each
 * header via `setResponseHeader` (the singular form — the plural
 * `setResponseHeaders` is a known no-op in global middleware as of
 * tanstack/router#5407).
 */
export function securityHeadersForPath(
  pathname: string,
): ReadonlyArray<readonly [string, string]> {
  if (isEmbeddablePath(pathname)) {
    // Embeddable response: drop X-Frame-Options + frame-ancestors so
    // the iframe load isn't blocked, but keep nosniff + HSTS so the
    // PDF bytes are still served safely.
    return [
      ["Content-Security-Policy", EMBEDDABLE_CSP_VALUE],
      [
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      ],
      ["X-Frame-Options", "SAMEORIGIN"],
      ["Referrer-Policy", "strict-origin-when-cross-origin"],
      ["X-Content-Type-Options", "nosniff"],
    ];
  }
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

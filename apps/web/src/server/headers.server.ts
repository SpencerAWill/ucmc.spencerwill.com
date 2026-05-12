/**
 * Sitewide security response headers. The values here are the source of
 * truth — applied via the global request middleware in `src/start.ts`
 * to every page render and server-fn response.
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

/**
 * Map of header name to header value. Iterated in `start.ts` and applied
 * one at a time via `setResponseHeader` (the singular form — the plural
 * `setResponseHeaders` is a known-broken in global middleware as of
 * tanstack/router#5407).
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Content-Security-Policy", CSP_VALUE],
  // Pin TLS for one year, include subdomains, and signal eligibility
  // for the HSTS preload list. Cloudflare also enforces HTTPS at the
  // edge, so this is belt-and-suspenders against MITM downgrades.
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    // Camera is allowed on the same origin only — the gear-cave
    // checkout flow opens the rear camera via getUserMedia +
    // BarcodeDetector to scan gear labels. Microphone / geolocation /
    // payment stay disabled (no feature uses them).
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=()",
  ],
  ["X-Content-Type-Options", "nosniff"],
];

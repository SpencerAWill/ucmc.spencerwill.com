/**
 * TanStack Start instance + global request middleware. Auto-discovered
 * by the Vite plugin (`@tanstack/react-start/plugin/vite`) from this
 * conventional path; the framework wires the registered middleware
 * into every page render and server-fn response.
 *
 * The single global middleware here injects the sitewide security
 * response headers (CSP report-only, HSTS, X-Frame-Options, etc.).
 * Header values live in `#/server/headers.server` so they're version-
 * controlled and auditable independent of the middleware mechanics.
 */
import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

import { SECURITY_HEADERS } from "#/server/headers.server";

const securityHeadersMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next }) => {
  // setResponseHeader (singular) is used because setResponseHeaders
  // (plural) is a known no-op in global middleware
  // (tanstack/router#5407). One call per header is fine — there are
  // only a handful — and matches the per-header API exactly.
  for (const [name, value] of SECURITY_HEADERS) {
    setResponseHeader(name, value);
  }
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));

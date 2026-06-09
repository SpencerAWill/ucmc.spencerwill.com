/**
 * TanStack Start instance + global request middleware. Auto-discovered
 * by the Vite plugin (`@tanstack/react-start/plugin/vite`) from this
 * conventional path; the framework wires the registered middleware
 * into every page render and server-fn response.
 *
 * The single global middleware here injects the sitewide security
 * response headers (CSP, HSTS, X-Frame-Options, etc.).
 * Header values live in `#/server/headers.server` so they're version-
 * controlled and auditable independent of the middleware mechanics.
 *
 * It also registers the Temporal serialization adapters so Temporal
 * values (returned from server fns / route loaders, now that DB
 * timestamps are `Temporal.Instant`) survive the SSR + server-fn wire.
 */
import { createMiddleware, createStart } from "@tanstack/react-start";
import { getRequestUrl, setResponseHeader } from "@tanstack/react-start/server";

import { securityHeadersForPath } from "#/server/headers.server";
import { temporalSerializationAdapters } from "#/lib/temporal-serialization";

const securityHeadersMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next }) => {
  // setResponseHeader (singular) is used because setResponseHeaders
  // (plural) is a known no-op in global middleware
  // (tanstack/router#5407). One call per header is fine — there are
  // only a handful — and matches the per-header API exactly.
  // Pathname is passed in so Permissions-Policy can scope `camera`
  // to the gear-cave scanner routes only.
  const pathname = getRequestUrl().pathname;
  for (const [name, value] of securityHeadersForPath(pathname)) {
    setResponseHeader(name, value);
  }
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
  serializationAdapters: temporalSerializationAdapters,
}));

// Register the Start instance config so the serialization adapters are
// known at the type level (`RegisteredSerializableInput`). Runtime
// (de)serialization works regardless; this surfaces the adapter set to
// the type system.
declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}

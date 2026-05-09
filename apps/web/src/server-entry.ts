/**
 * Cloudflare Worker entry point. Wraps TanStack Start's default server
 * entry (which provides `fetch`) with:
 *   - a `scheduled` handler so cron triggers declared in
 *     `wrangler.jsonc` reach our retention sweeps; and
 *   - an anonymous home-page cache layer that serves `/` from
 *     `caches.default` for cookie-less GETs (see `./server/edge-cache`).
 *
 * `wrangler.jsonc` `main` points here instead of straight at the
 * TanStack package.
 */
import startEntry from "@tanstack/react-start/server-entry";

import { withAnonymousHomeCache } from "./server/edge-cache";
import type { WorkerFetchHandler } from "./server/edge-cache";

// `startEntry.fetch` is typed `(request, opts?)` even though the
// Cloudflare runtime always invokes it as `(request, env, ctx)` via
// the standard ExportedHandler contract. Cast to the runtime shape so
// the wrapper's `inner.call(request, env, ctx)` typechecks without
// losing the runtime invocation. (This same gap is why the original
// `satisfies` line used `typeof startEntry.fetch` rather than
// `ExportedHandlerFetchHandler` — keeping that to avoid further drift.)
const cachedFetch = withAnonymousHomeCache(
  startEntry.fetch as unknown as WorkerFetchHandler,
);

// `ExportedHandler<WorkerEnv>` from @cloudflare/workers-types declares
// `fetch` with a Request shape that doesn't match the one TanStack
// Start's handler expects (the latter omits a few standard Fetch
// properties). Spreading the Start handler and overriding `fetch` +
// adding `scheduled` gives us the right runtime shape; we annotate
// `scheduled` individually so the cron contract is type-checked
// without fighting TypeScript over the fetch signature.
export default {
  ...startEntry,

  fetch: cachedFetch as unknown as typeof startEntry.fetch,

  async scheduled(_event, _env, ctx) {
    // Server-only import. Lazy-loaded so the worker entry's static
    // module graph stays small and matches the dynamic-import pattern
    // used by the server-fn shells.
    const { runRetentionSweeps } =
      await import("./server/cron/retention.server");
    ctx.waitUntil(runRetentionSweeps());
  },
} satisfies {
  fetch: typeof startEntry.fetch;
  scheduled: (
    event: ScheduledEvent,
    env: unknown,
    ctx: ExecutionContext,
  ) => Promise<void>;
};

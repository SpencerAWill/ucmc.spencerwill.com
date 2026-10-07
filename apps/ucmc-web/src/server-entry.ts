/**
 * Cloudflare Worker entry point. Wraps TanStack Start's default server
 * entry (which provides `fetch`) with:
 *   - a `scheduled` handler so cron triggers declared in
 *     `wrangler.jsonc` reach our retention sweeps; and
 *   - a public-page cache layer that serves cookie-less GETs to a
 *     known set of public pages (`/`, `/about`, `/membership`, the
 *     legal/policy routes) from `caches.default` (see
 *     `./server/edge-cache`).
 *
 * `wrangler.jsonc` `main` points here instead of straight at the
 * TanStack package.
 *
 * The first import installs the TC39 Temporal global polyfill. workerd
 * has no native `Temporal`, so it must be patched in before any module
 * (schema column mappers, server fns, cron handlers) touches it.
 */
import "temporal-polyfill/global";

import startEntry from "@tanstack/react-start/server-entry";

import { withPublicPageCache } from "./server/edge-cache";
import type { WorkerFetchHandler } from "./server/edge-cache";
import { errorMessage, log, runWithLogContext } from "./server/log/log.server";

/**
 * Bind a correlation id to everything the request logs.
 *
 * `cf-ray` is Cloudflare's own request identifier — the one the
 * dashboard, Workers Logs and a support ticket all agree on — so it
 * beats minting a uuid nobody else can see. It is absent in local dev
 * and under `vite preview`, where a random id still lets one request's
 * lines be grouped.
 *
 * This wraps OUTSIDE the cache layer deliberately: a cache hit is a
 * request too, and "which requests never reached the origin" is
 * exactly the question the log has to be able to answer.
 */
function withLogContext(inner: WorkerFetchHandler): WorkerFetchHandler {
  return function fetchWithLogContext(request, env, ctx) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    return runWithLogContext({ requestId }, () => inner(request, env, ctx));
  };
}

// `startEntry.fetch` is typed `(request, opts?)` even though the
// Cloudflare runtime always invokes it as `(request, env, ctx)` via
// the standard ExportedHandler contract. Cast to the runtime shape so
// the wrapper's `inner.call(request, env, ctx)` typechecks without
// losing the runtime invocation. (This same gap is why the original
// `satisfies` line used `typeof startEntry.fetch` rather than
// `ExportedHandlerFetchHandler` — keeping that to avoid further drift.)
const cachedFetch = withLogContext(
  withPublicPageCache(startEntry.fetch as unknown as WorkerFetchHandler),
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

  async scheduled(event, _env, ctx) {
    // Dispatch by `event.cron` so additional schedules are a single
    // branch each, rather than every job firing on every tick.
    //
    // Schedules currently wired (must match wrangler.jsonc):
    //   - "0 8 * * *"   → daily retention sweeps
    //   - "15 8 1 3 *"  → annual officer-archive snapshot (March 1)
    //
    // Every branch runs inside a log context carrying the cron
    // expression: a scheduled invocation has no `cf-ray` to correlate
    // on, and "which tick produced this" is the only question worth
    // asking of a cron log line.
    if (event.cron === "15 8 1 3 *") {
      const { archiveCurrentOfficers } =
        await import("./server/cron/archive-officers.server");
      ctx.waitUntil(
        runWithLogContext({ cron: event.cron }, () =>
          archiveCurrentOfficers().then(
            (result) => log.info("officers.archive_complete", { ...result }),
            (err: unknown) =>
              log.error("officers.archive_failed", {
                error: errorMessage(err),
              }),
          ),
        ),
      );
      return;
    }

    // Default fallback: daily retention. Catches "0 8 * * *" plus any
    // future daily schedules that piggyback on the same wakeup.
    const { runRetentionSweeps } =
      await import("./server/cron/retention.server");
    ctx.waitUntil(
      runWithLogContext({ cron: event.cron }, () => runRetentionSweeps()),
    );
  },
} satisfies {
  fetch: typeof startEntry.fetch;
  scheduled: (
    event: ScheduledEvent,
    env: unknown,
    ctx: ExecutionContext,
  ) => Promise<void>;
};

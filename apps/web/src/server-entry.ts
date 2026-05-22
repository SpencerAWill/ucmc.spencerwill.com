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
 */
import startEntry from "@tanstack/react-start/server-entry";

import { withPublicPageCache } from "./server/edge-cache";
import type { WorkerFetchHandler } from "./server/edge-cache";

// `startEntry.fetch` is typed `(request, opts?)` even though the
// Cloudflare runtime always invokes it as `(request, env, ctx)` via
// the standard ExportedHandler contract. Cast to the runtime shape so
// the wrapper's `inner.call(request, env, ctx)` typechecks without
// losing the runtime invocation. (This same gap is why the original
// `satisfies` line used `typeof startEntry.fetch` rather than
// `ExportedHandlerFetchHandler` — keeping that to avoid further drift.)
const cachedFetch = withPublicPageCache(
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

  async scheduled(event, _env, ctx) {
    // Dispatch by `event.cron` so additional schedules are a single
    // branch each, rather than every job firing on every tick.
    //
    // Schedules currently wired (must match wrangler.jsonc):
    //   - "0 8 * * *"   → daily retention sweeps
    //   - "15 8 1 3 *"  → annual officer-archive snapshot (March 1)
    if (event.cron === "15 8 1 3 *") {
      const { archiveCurrentOfficers } =
        await import("./server/cron/archive-officers.server");
      ctx.waitUntil(
        archiveCurrentOfficers().then(
          (result) =>
            // eslint-disable-next-line no-console
            console.log("officers.archive_complete", result),
          (err: unknown) =>
            // eslint-disable-next-line no-console
            console.error("officers.archive_failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
        ),
      );
      return;
    }

    // Default fallback: daily retention. Catches "0 8 * * *" plus any
    // future daily schedules that piggyback on the same wakeup.
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

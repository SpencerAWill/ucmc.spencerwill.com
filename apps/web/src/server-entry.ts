/**
 * Cloudflare Worker entry point. Wraps TanStack Start's default server
 * entry (which provides `fetch`) with a `scheduled` handler so cron
 * triggers declared in `wrangler.jsonc` reach our retention sweeps.
 *
 * `wrangler.jsonc` `main` points here instead of straight at the
 * TanStack package; the only meaningful difference is the additional
 * scheduled export.
 */
import startEntry from "@tanstack/react-start/server-entry";

// `ExportedHandler<WorkerEnv>` from @cloudflare/workers-types declares
// `fetch` with a Request shape that doesn't match the one TanStack
// Start's handler expects (the latter omits a few standard Fetch
// properties). Spreading the Start handler and adding a `scheduled`
// key gives us the right runtime shape; we annotate `scheduled`
// individually so the cron contract is type-checked without fighting
// TypeScript over the fetch signature.
export default {
  ...startEntry,

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

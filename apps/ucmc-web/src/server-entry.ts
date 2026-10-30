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
 * The first import installs the TC39 Temporal polyfill onto the global,
 * replacing any native `Temporal` the runtime ships (see
 * `./lib/temporal-install`), before any module (schema column mappers,
 * server fns, cron handlers) touches it.
 */
import "#/lib/temporal-install";

import startEntry from "@tanstack/react-start/server-entry";

import { withPublicPageCache } from "./server/edge-cache";
import type { WorkerFetchHandler } from "./server/edge-cache";
import { isDailyCron } from "./server/cron/daily-schedule";
import { serverEnv } from "./server/env.server";
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

/**
 * Validate the vars and secrets before anything else runs (#319).
 *
 * A misconfigured deploy then fails every request from the first one —
 * cache hits included, which is why this wraps the cache layer rather
 * than living in Start's request middleware — and the post-deploy smoke
 * test sees it. The response says nothing about which variable: the log
 * line has the names (never the values), the visitor gets a plain 500.
 */
function withEnvCheck(inner: WorkerFetchHandler): WorkerFetchHandler {
  return function fetchWithEnvCheck(request, env, ctx) {
    if (!envIsValid()) {
      return Promise.resolve(
        new Response("This site is misconfigured.", { status: 500 }),
      );
    }
    return inner(request, env, ctx);
  };
}

/**
 * The env cannot change inside an isolate (a deploy or a secret change
 * starts new ones), so a failure is remembered and logged once per
 * isolate rather than re-parsed and re-logged on every request.
 */
const envCheck: { failed?: boolean } = {};

function envIsValid(): boolean {
  if (envCheck.failed) {
    return false;
  }
  try {
    serverEnv();
    return true;
  } catch (err) {
    envCheck.failed = true;
    log.error("env.invalid", { error: errorMessage(err) });
    return false;
  }
}

// `startEntry.fetch` is typed `(request, opts?)` even though the
// Cloudflare runtime always invokes it as `(request, env, ctx)` via
// the standard ExportedHandler contract. Cast to the runtime shape so
// the wrapper's `inner.call(request, env, ctx)` typechecks without
// losing the runtime invocation. (This same gap is why the original
// `satisfies` line used `typeof startEntry.fetch` rather than
// `ExportedHandlerFetchHandler` — keeping that to avoid further drift.)
const cachedFetch = withLogContext(
  withEnvCheck(
    withPublicPageCache(startEntry.fetch as unknown as WorkerFetchHandler),
  ),
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
    //   - "0 12 * * *"  → daily retention sweeps + gear reminders +
    //                     cost snapshot + feedback sync + calendar
    //                     token scrub
    //                     (08:00 EDT / 07:00 EST — see
    //                     ./server/cron/daily-schedule)
    //   - "15 8 1 3 *"  → annual officer-archive snapshot (March 1)
    //
    // Every branch runs inside a log context carrying the cron
    // expression: a scheduled invocation has no `cf-ray` to correlate
    // on, and "which tick produced this" is the only question worth
    // asking of a cron log line.
    //
    // A misconfigured Worker runs no task at all, the same as it serves
    // no request: one error line beats five tasks each failing on
    // whichever variable it reaches first.
    const envOk = runWithLogContext({ cron: event.cron }, envIsValid);
    if (!envOk) {
      return;
    }

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

    // The daily tick, matched EXPLICITLY rather than as a fallback.
    //
    // This used to be `else { …retention… }`, which quietly made every
    // unrecognised expression run the sweeps — so adding a second daily
    // schedule for any reason would have run retention twice a day
    // without a word. Matching the expression and warning on anything
    // else turns that from a silent trap into a log line.
    if (!isDailyCron(event.cron)) {
      // An expression in wrangler.jsonc with no branch here is a
      // misconfiguration. Say so instead of running something arbitrary.
      log.warn("cron.unrecognised", { cron: event.cron });
      return;
    }

    const [
      { runRetentionSweeps },
      { runGearLoanReminders },
      { runCostSnapshot },
      { runSiteFeedbackIssueSync },
      { scrubSubscriptionTokens },
    ] = await Promise.all([
      import("./server/cron/retention.server"),
      import("./server/cron/gear-reminders.server"),
      import("./server/cron/cost-snapshot.server"),
      import("./features/site-feedback/server/sync.server"),
      import("./features/calendar/server/feed-actions.server"),
    ]);
    ctx.waitUntil(
      runWithLogContext({ cron: event.cron }, async () => {
        // Independent: a failed sweep must not cost members their
        // reminders, and a provider outage must not stop the retention
        // promises on /privacy from being kept. `allSettled`, not `all`.
        const [sweeps, reminders, costs, feedbackSync, tokenBackfill] =
          await Promise.allSettled([
            runRetentionSweeps(),
            runGearLoanReminders({ now: Temporal.Now.instant() }),
            // Third independent task: a vendor API outage must not cost
            // members their reminders, and nothing here may stop the
            // retention promises on /privacy from being kept.
            runCostSnapshot(),
            // Fourth: a GitHub outage must not cost anyone the above. The
            // job catches its own errors; this entry is the backstop.
            runSiteFeedbackIssueSync(),
            // Fifth: no calendar_subscriptions row may hold a usable
            // feed token (#379).
            scrubSubscriptionTokens(),
          ]);
        if (sweeps.status === "rejected") {
          log.error("retention.sweeps_failed", {
            error: errorMessage(sweeps.reason),
          });
        }
        if (reminders.status === "rejected") {
          log.error("gear_reminders.run_failed", {
            error: errorMessage(reminders.reason),
          });
        }
        if (costs.status === "rejected") {
          log.error("cost.snapshot_failed", {
            error: errorMessage(costs.reason),
          });
        }
        if (feedbackSync.status === "rejected") {
          log.error("site_feedback.sync_failed", {
            error: errorMessage(feedbackSync.reason),
          });
        }
        if (tokenBackfill.status === "rejected") {
          log.error("calendar.token_scrub_failed", {
            error: errorMessage(tokenBackfill.reason),
          });
        } else {
          log.info("calendar.token_scrub_complete", {
            ...tokenBackfill.value,
          });
        }
      }),
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

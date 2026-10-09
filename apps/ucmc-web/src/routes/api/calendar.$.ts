import { createFileRoute } from "@tanstack/react-router";

import { eventKind } from "#/../drizzle/schema";
import type { EventKind } from "#/../drizzle/schema";

/**
 * The subscribable calendar feeds (issue #187).
 *
 *   `/api/calendar/public.ics`   — anonymous, `visibility = 'public'`
 *   `/api/calendar/<token>.ics`  — one member's feed, bearer token
 *
 * **These are the only routes in the app that authenticate without a
 * session.** A calendar client polls in the background with no cookies
 * and no way to complete an auth flow, so the member feed carries an
 * opaque per-user token in its URL instead.
 *
 * `public` can never collide with a real token: tokens are uuidv7, and
 * the literal is checked first regardless.
 *
 * **A bad token answers 404, never 403.** Distinguishing "no such
 * token" from "revoked" would turn this into an oracle for walking
 * token space, and the endpoint is publicly reachable by design. For
 * the same reason the token is never logged and never lands in an
 * audit row's `target_id`.
 *
 * An optional `?kind=trip,meeting` filter lets a member subscribe to
 * the same token several times and get separately-coloured calendars in
 * their phone — which is what people who care about this actually want,
 * and costs one query parameter rather than a second table of stored
 * per-feed preferences.
 */

/** `<token>.ics` or `public.ics`. */
const SPLAT_PATTERN = /^([A-Za-z0-9-]{1,64})\.ics$/;

function parseKinds(raw: string | null): EventKind[] | undefined {
  if (!raw) {
    return undefined;
  }
  const allowed = new Set<string>(eventKind);
  const kinds = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is EventKind => allowed.has(value));
  return kinds.length > 0 ? kinds : undefined;
}

export const Route = createFileRoute("/api/calendar/$")({
  server: {
    handlers: {
      GET: async ({
        params,
        request,
      }: {
        params: { _splat?: string };
        request: Request;
      }) => {
        const notFound = () => new Response("Not found", { status: 404 });

        const match = SPLAT_PATTERN.exec(params._splat ?? "");
        if (!match) {
          return notFound();
        }
        const identifier = match[1];

        const { readSetting } =
          await import("#/server/settings/settings-repo.server");
        // The feed's own switch, not `pages.calendar`: switching a page
        // off and breaking every member's phone are different acts.
        if (!(await readSetting("calendar.feed_enabled"))) {
          return notFound();
        }

        const { checkCalendarFeedRateLimit } =
          await import("#/server/rate-limit.server");
        const {
          buildFeedAction,
          resolveSubscriptionToken,
          scopeForSubscriber,
        } = await import("#/features/calendar/server/feed-actions.server");
        const { PUBLIC_SCOPE } =
          await import("#/server/events/events-repo.server");

        const isPublicFeed = identifier === "public";
        // The public feed has no token to key on, so it falls back to
        // the caller's IP.
        const rateKey = isPublicFeed
          ? `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`
          : `token:${identifier}`;
        if (!(await checkCalendarFeedRateLimit(rateKey))) {
          return new Response("Too many requests", { status: 429 });
        }

        let scope = PUBLIC_SCOPE;
        let calendarName = "UCMC";
        if (!isPublicFeed) {
          const userId = await resolveSubscriptionToken(identifier);
          if (!userId) {
            return notFound();
          }
          // Scope is resolved from the user's CURRENT permissions on
          // every fetch, never baked into the token — which is the only
          // revocation story a subscription URL can have. An officer
          // who loses their role stops seeing exec events on their next
          // poll.
          scope = await scopeForSubscriber(userId);
          calendarName = "UCMC (my calendar)";
        }

        const kinds = parseKinds(new URL(request.url).searchParams.get("kind"));
        const { ics, etag } = await buildFeedAction(scope, calendarName, kinds);

        // Most clients send If-None-Match, so an unchanged feed costs a
        // 304 rather than a re-render and a few KB on every poll.
        if (request.headers.get("if-none-match") === `"${etag}"`) {
          return new Response(null, {
            status: 304,
            headers: { ETag: `"${etag}"` },
          });
        }

        return new Response(ics, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            // `private` on the member feed: the URL is a bearer
            // credential and must not be cached by anything shared.
            "Cache-Control": isPublicFeed
              ? "public, max-age=3600"
              : "private, max-age=1800",
            ETag: `"${etag}"`,
            // Clients that follow the filename get a sensible one
            // instead of the splat.
            "Content-Disposition": 'inline; filename="ucmc.ics"',
          },
        });
      },
    },
  },
});

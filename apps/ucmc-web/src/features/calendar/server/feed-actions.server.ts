/**
 * The subscribable `.ics` feeds (issue #187).
 *
 * **These are the only read paths in the app with no session.** A
 * calendar client fetches on a background schedule with no cookies and
 * no ability to complete an auth flow, so the personal feed is
 * authenticated by an opaque bearer token in the URL instead.
 *
 * The consequences that shape this file:
 *
 *   - Visibility is computed from the token's user **at fetch time**,
 *     never baked into the token. An officer who loses their role stops
 *     seeing exec events on their next poll, which is the only
 *     revocation story a subscription URL can have.
 *   - The route is publicly reachable by design, so it is rate-limited
 *     on the token.
 *   - A token is a credential. It is never logged, never put in an
 *     audit row's `target_id`, and a bad one answers 404 rather than
 *     403 — a distinguishable "that token exists but is revoked" turns
 *     the endpoint into an oracle for guessing them.
 *
 * Feeds emit SERIES, not expanded occurrences: one VEVENT with its
 * RRULE, plus EXDATEs and RECURRENCE-ID overrides. See
 * `seriesAsOccurrence` for why an expanded feed is the wrong answer.
 */
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { loadPrincipal } from "#/server/auth/principal.server";
import { getDb, schema } from "#/server/db";
import type { EventKind } from "#/../drizzle/schema";
import {
  PUBLIC_SCOPE,
  listEventSeriesForWindow,
  listExceptionsFor,
  visibilityScopeFor,
} from "#/server/events/events-repo.server";
import type { VisibilityScope } from "#/server/events/events-repo.server";
import type { IcalSeries } from "#/server/events/ical";
import { renderCalendar } from "#/server/events/ical";
import { expandOccurrences } from "#/server/events/recurrence";
import {
  overrideAsOccurrence,
  seriesAsOccurrence,
} from "#/server/events/occurrences";

/**
 * How far back a feed reaches.
 *
 * Ninety days, so a member who subscribes mid-semester still sees the
 * recent past their calendar app may use for context — and so a
 * recently cancelled event is still *present* long enough to carry its
 * STATUS:CANCELLED to every client that polls.
 */
const FEED_PAST_DAYS = 90;

/**
 * How far forward. A year and a bit, which matters only for bounding
 * the SQL window: recurring series are emitted as rules, so their
 * occurrences are not capped by this at all.
 */
const FEED_FUTURE_DAYS = 400;

export interface FeedResult {
  ics: string;
  /** For the ETag, so an unchanged feed answers 304. */
  etag: string;
}

/**
 * Resolve a subscription token to its user id, or null.
 *
 * Also stamps `last_fetched_at`, which is how "my calendar is stale" is
 * diagnosed — it answers whether the client is polling at all before
 * anyone starts guessing about caches.
 */
export async function resolveSubscriptionToken(
  token: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({
      id: schema.calendarSubscriptions.id,
      userId: schema.calendarSubscriptions.userId,
    })
    .from(schema.calendarSubscriptions)
    .where(
      and(
        eq(schema.calendarSubscriptions.token, token),
        isNull(schema.calendarSubscriptions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows.at(0);
  if (!row) {
    return null;
  }

  await getDb()
    .update(schema.calendarSubscriptions)
    .set({ lastFetchedAt: Temporal.Now.instant() })
    .where(eq(schema.calendarSubscriptions.id, row.id));

  return row.userId;
}

/** The visibility scope a subscription's owner currently holds. */
export async function scopeForSubscriber(
  userId: string,
): Promise<VisibilityScope> {
  const principal = await loadPrincipal(userId);
  if (!principal) {
    return PUBLIC_SCOPE;
  }
  return visibilityScopeFor(
    principal.status === "approved",
    principal.permissions.includes("events:read_private"),
  );
}

/**
 * Build a feed for a scope.
 *
 * The ETag is a content hash rather than a timestamp: calendar clients
 * poll on their own schedule and most send
 * `If-None-Match`, so an unchanged feed costs a 304 instead of a
 * re-render and a few KB. A `max(updated_at)` would miss a deletion.
 */
export async function buildFeedAction(
  scope: VisibilityScope,
  calendarName: string,
  kinds?: readonly EventKind[],
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<FeedResult> {
  const from = now.subtract({ hours: FEED_PAST_DAYS * 24 });
  const until = now.add({ hours: FEED_FUTURE_DAYS * 24 });

  const seriesList = await listEventSeriesForWindow(scope, from, until, kinds);
  const exceptionsByEvent = await listExceptionsFor(
    seriesList.map((row) => row.id),
  );

  const entries: IcalSeries[] = seriesList.map((series) => {
    const exceptions = exceptionsByEvent.get(series.id) ?? [];
    const exdates: Temporal.Instant[] = [];
    const overrides = [];

    for (const exception of exceptions) {
      if (exception.canceled) {
        exdates.push(exception.occurrenceStart);
        continue;
      }
      // A moved occurrence needs the span the series WOULD have
      // produced, so any field the override leaves null still inherits
      // a real start and end rather than the series anchor's.
      // `.at(0)` rather than a destructure, because this really can
      // come back empty: an exception whose slot the series no longer
      // generates (the rule tightened under it) has nothing to inherit
      // from, and the destructured form would type that away.
      const generated = expandOccurrences(
        series,
        exception.occurrenceStart,
        exception.occurrenceStart.add({ hours: 24 }),
      ).at(0);
      overrides.push(
        overrideAsOccurrence(
          series,
          exception,
          generated?.startsAt ?? exception.occurrenceStart,
          generated?.endsAt ?? null,
        ),
      );
    }

    return { series: seriesAsOccurrence(series), exdates, overrides };
  });

  const ics = renderCalendar(entries, calendarName, now);
  return { ics, etag: await contentEtag(ics) };
}

/** Mint a subscription token for a member. */
export async function createSubscriptionToken(
  userId: string,
  label: string | null,
): Promise<{ id: string; token: string }> {
  const id = `cal_${uuidv7()}`;
  // uuidv7 rather than `generatePublicId()`: this is a bearer
  // credential that ends up in Google's and Apple's fetchers, so it
  // wants the full 122 bits rather than the 12-character alphabet that
  // is fine for a guessable-but-harmless URL id.
  const token = uuidv7();
  await getDb()
    .insert(schema.calendarSubscriptions)
    .values({ id, userId, token, label });
  return { id, token };
}

/**
 * SHA-256 of the rendered feed, with `DTSTAMP` lines removed first.
 *
 * **Stripping DTSTAMP is what makes the ETag mean anything.** That
 * property is "when this copy was generated" and is set from
 * `Temporal.Now` on every request, so hashing the raw body produced a
 * tag that changed every second regardless of whether a single event
 * had moved. `If-None-Match` then matched only for two polls inside the
 * same second, and every client re-downloaded the whole feed forever —
 * precisely the opposite of the intent.
 *
 * Everything that describes the *content* survives the strip, so a
 * changed title, a new event, a deletion or a cancellation all still
 * move the tag. A deletion is also why this hashes the rendering rather
 * than `max(updated_at)`: nothing's timestamp moves when a row
 * disappears.
 *
 * `crypto.subtle` is available in workerd; this is a cache key, not a
 * security boundary, so the truncation is fine.
 */
async function contentEtag(body: string): Promise<string> {
  const stable = body.replace(/^DTSTAMP:.*\r?\n/gm, "");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

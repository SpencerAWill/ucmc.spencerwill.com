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
 *   - D1 only ever holds its SHA-256, `token_hash` (#379), as with
 *     sessions, so a backup, export or Time Travel restore holds no
 *     working feed URL.
 *
 * Feeds emit SERIES, not expanded occurrences: one VEVENT with its
 * RRULE, plus EXDATEs and RECURRENCE-ID overrides. See
 * `seriesAsOccurrence` for why an expanded feed is the wrong answer.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { hashToken } from "#/server/auth/bearer-token.server";
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
  const tokenHash = await hashToken(token);
  const rows = await getDb()
    .select({
      id: schema.calendarSubscriptions.id,
      userId: schema.calendarSubscriptions.userId,
    })
    .from(schema.calendarSubscriptions)
    .where(
      and(
        eq(schema.calendarSubscriptions.tokenHash, tokenHash),
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

/**
 * What the `token` column holds instead of a token. The column is still
 * NOT NULL UNIQUE (relaxing that is a table rebuild), so it holds this
 * per-row value: unique, and the `:` keeps it outside the feed URL's
 * alphabet, so it can never be presented as one.
 */
const TOKEN_SENTINEL_PREFIX = "hashed:";

function tokenSentinel(id: string): string {
  return `${TOKEN_SENTINEL_PREFIX}${id}`;
}

/**
 * Make sure no row holds a usable token (#379).
 *
 * Runs on the daily cron, and stays there as a guard rather than a
 * one-off. Two kinds of row can still carry a raw `token`:
 *
 *   - **Hashed, raw value kept.** Everything the first phase of #379
 *     minted or backfilled, including any its code writes while this
 *     deploy rolls out. The first tick after this deploy clears them.
 *   - **Not hashed at all.** Only a writer that bypasses
 *     `createSubscriptionToken` (a seed script, hand-written SQL) or a
 *     link minted before #379 that the first phase's backfill somehow
 *     missed. Their URLs 404 until this runs, because the raw-token
 *     fallback is gone; this hashes them so they work again.
 *
 * Revoked rows are included: they are kept forever so the UNIQUE index
 * never reissues a token, and their raw values leak just the same.
 *
 * At most three queries whatever the row count, because the daily tick
 * shares Workers Free's 50-query budget with every other sweep: hashes
 * go to one UPDATE as a single JSON parameter (`data/core.md`).
 */
export async function scrubSubscriptionTokens(): Promise<{
  hashed: number;
  cleared: number;
}> {
  const db = getDb();
  const unhashed = await db
    .select({
      id: schema.calendarSubscriptions.id,
      token: schema.calendarSubscriptions.token,
    })
    .from(schema.calendarSubscriptions)
    .where(isNull(schema.calendarSubscriptions.tokenHash));
  const hashed = unhashed.length === 0 ? 0 : await hashUnhashedRows(unhashed);

  const cleared = await db.run(sql`
    UPDATE calendar_subscriptions
    SET token = ${TOKEN_SENTINEL_PREFIX} || id
    WHERE token_hash IS NOT NULL
      AND token NOT LIKE ${`${TOKEN_SENTINEL_PREFIX}%`}
  `);
  return { hashed, cleared: cleared.meta.changes };
}

/**
 * Hash and clear rows with no `token_hash`, in one statement. Returns
 * the rows changed, which the UPDATE's `token_hash IS NULL` re-check
 * keeps honest if a row was hashed in between.
 */
async function hashUnhashedRows(
  rows: readonly { id: string; token: string }[],
): Promise<number> {
  const replacements = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      hash: await hashToken(row.token),
      sentinel: tokenSentinel(row.id),
    })),
  );
  // `UPDATE … FROM` joins the JSON once, rather than a correlated
  // subquery per column per row re-walking the whole array.
  const result = await getDb().run(sql`
    UPDATE calendar_subscriptions
    SET token_hash = replacement.hash, token = replacement.sentinel
    FROM (
      SELECT
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.hash') AS hash,
        json_extract(value, '$.sentinel') AS sentinel
      FROM json_each(${JSON.stringify(replacements)})
    ) AS replacement
    WHERE calendar_subscriptions.id = replacement.id
      AND calendar_subscriptions.token_hash IS NULL
  `);
  return result.meta.changes;
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

/**
 * 256 random bits as 64 hex characters.
 *
 * This is a bearer credential that ends up in Google's and Apple's
 * fetchers. It was a uuidv7, whose leading 48 bits are a timestamp,
 * leaving 74 random ones. Hex rather than `generateToken()`'s base64url
 * so that a link minted now still fits the route pattern
 * (`[A-Za-z0-9-]{1,64}`, no `_`) of the first phase of #379, which is
 * what a code-only rollback of this one lands on. Only the hash is
 * stored; the token is returned once, here.
 */
function generateFeedToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Mint a subscription token for a member. */
export async function createSubscriptionToken(
  userId: string,
  label: string | null,
): Promise<{ id: string; token: string }> {
  const id = `cal_${uuidv7()}`;
  const token = generateFeedToken();
  await getDb()
    .insert(schema.calendarSubscriptions)
    .values({
      id,
      userId,
      token: tokenSentinel(id),
      tokenHash: await hashToken(token),
      label,
    });
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

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
 *   - It is looked up by its SHA-256, `token_hash` (#379), as with
 *     sessions. The raw `token` column is still written in this first
 *     phase so that a code-only rollback keeps every feed working; the
 *     follow-up stops writing it and clears it, after which a backup,
 *     export or Time Travel restore holds no working feed URL.
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

  const row = rows.at(0) ?? (await resolveLegacyToken(token));
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
 * A URL minted before #379, whose row has no hash yet.
 *
 * **Migration shim**: these URLs live in members' phone calendars,
 * which poll in the background and fail silently, so they have to keep
 * working until the daily backfill reaches their row. A hit hashes the
 * row on the spot. Remove with `backfillSubscriptionTokenHashes` once
 * no row is unhashed.
 */
async function resolveLegacyToken(
  token: string,
): Promise<{ id: string; userId: string } | undefined> {
  const rows = await getDb()
    .select({
      id: schema.calendarSubscriptions.id,
      userId: schema.calendarSubscriptions.userId,
    })
    .from(schema.calendarSubscriptions)
    .where(
      and(
        eq(schema.calendarSubscriptions.token, token),
        isNull(schema.calendarSubscriptions.tokenHash),
        isNull(schema.calendarSubscriptions.revokedAt),
      ),
    )
    .limit(1);
  const row = rows.at(0);
  if (row) {
    await getDb()
      .update(schema.calendarSubscriptions)
      .set({ tokenHash: await hashToken(token) })
      .where(
        and(
          eq(schema.calendarSubscriptions.id, row.id),
          isNull(schema.calendarSubscriptions.tokenHash),
        ),
      );
  }
  return row;
}

/**
 * Give every row without one its `token_hash`, live or revoked (#379).
 *
 * It does not clear `token`: rolling the code back must keep every feed
 * working, and the old code looks rows up by the raw value. Clearing it
 * is the follow-up, once this has run in prod.
 *
 * Runs on the daily cron. Revoked rows are included because they are
 * kept forever so the UNIQUE index never reissues a token, and that
 * guarantee has to move to `token_hash` with them. It also catches rows
 * the previous code version minted in the window between the migration
 * and the deploy, which is why it is idempotent rather than one-off.
 *
 * Two queries whatever the row count: the daily tick shares Workers
 * Free's 50-query invocation budget with every other sweep, so the
 * hashes go to one UPDATE as a single JSON parameter (`data/core.md`)
 * rather than one statement per row. The UPDATE re-checks
 * `token_hash IS NULL`, so a row the lazy path hashed in between is
 * left alone.
 *
 * **Migration shim**, with `resolveLegacyToken`: once prod logs
 * `hashed: 0` there is nothing left for either to do.
 */
export async function backfillSubscriptionTokenHashes(): Promise<{
  hashed: number;
}> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.calendarSubscriptions.id,
      token: schema.calendarSubscriptions.token,
    })
    .from(schema.calendarSubscriptions)
    .where(isNull(schema.calendarSubscriptions.tokenHash));
  if (rows.length === 0) {
    return { hashed: 0 };
  }
  const replacements = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      hash: await hashToken(row.token),
    })),
  );
  // `UPDATE … FROM` joins the JSON once, rather than a correlated
  // subquery per column per row re-walking the whole array.
  const result = await db.run(sql`
    UPDATE calendar_subscriptions
    SET token_hash = replacement.hash
    FROM (
      SELECT
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.hash') AS hash
      FROM json_each(${JSON.stringify(replacements)})
    ) AS replacement
    WHERE calendar_subscriptions.id = replacement.id
      AND calendar_subscriptions.token_hash IS NULL
  `);
  // The rows this UPDATE changed, not the rows it read: one the lazy
  // path hashed in between is skipped and must not be counted, or the
  // `hashed: 0` that retires this shim could be reported late or never.
  return { hashed: result.meta.changes };
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
 * so that a link minted now still fits the route pattern of the code
 * before #379 (`[A-Za-z0-9-]{1,64}`, no `_`), which is what keeps a
 * code-only rollback from breaking it.
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
    .values({ id, userId, token, tokenHash: await hashToken(token), label });
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

import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { ensureApprovedUser, execD1, queryD1 } from "./fixtures/db";

/**
 * The `.ics` feed ROUTE (issue #187).
 *
 * `buildFeedAction` is covered by unit tests; this covers the HTTP
 * handler wrapped around it, which is a different thing and a riskier
 * one. **It is the only publicly reachable, session-less endpoint in
 * the app** — no cookie, no CSRF token, no auth flow — so its contract
 * is the whole security boundary:
 *
 *   - a bad token must 404, never 403, or the endpoint becomes an
 *     oracle for walking token space;
 *   - a revoked token must stop working on the next request;
 *   - the feed flag must actually gate it;
 *   - `Cache-Control` must be `private` for a member feed, because the
 *     URL is a bearer credential and must not sit in a shared cache;
 *   - a 304 must be reachable, or every client re-downloads the whole
 *     feed on every poll forever.
 *
 * None of that is visible from the action layer. Driven through
 * Playwright's `request` rather than a page, since there is no page.
 */

const BASE = "http://localhost:3000";

/** Mint a subscription straight in the DB; the UI has its own coverage. */
function seedSubscription(email: string): string {
  ensureApprovedUser(email);
  const [user] = queryD1<{ id: string }>(
    `SELECT u.id as id FROM users u
     JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.email = ?`,
    email,
  );
  const token = crypto.randomUUID();
  execD1(
    `INSERT INTO calendar_subscriptions (id, user_id, token, created_at)
     VALUES ('cal_${token}', '${user.id}', '${token}', ${Date.now()})`,
  );
  return token;
}

function seedEvent(title: string, visibility: "public" | "members"): string {
  const publicId =
    `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(
      0,
      12,
    );
  const startsAt = Date.now() + 2 * 24 * 60 * 60 * 1000;
  execD1(
    `INSERT INTO events (id, public_id, title, starts_at, ends_at, kind, visibility)
     VALUES ('evt_${publicId}', '${publicId}', '${title}', ${startsAt}, ${startsAt + 3600000}, 'meeting', '${visibility}')`,
  );
  return publicId;
}

async function getFeed(request: APIRequestContext, path: string) {
  return request.get(`${BASE}${path}`, { failOnStatusCode: false });
}

test("the public feed serves iCalendar to an anonymous caller", async ({
  request,
}) => {
  seedEvent("Feed public open house", "public");

  const response = await getFeed(request, "/api/calendar/public.ics");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/text\/calendar/);
  // Shareable with anyone, so a shared cache is fine and wanted.
  expect(response.headers()["cache-control"]).toMatch(/public/);

  const body = await response.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("END:VCALENDAR");
  expect(body).toContain("BEGIN:VTIMEZONE");
  expect(body).toContain("SUMMARY:Feed public open house");
});

test("the public feed withholds members-only events", async ({ request }) => {
  seedEvent("Feed members night", "members");

  const body = await (
    await getFeed(request, "/api/calendar/public.ics")
  ).text();
  expect(body).not.toContain("Feed members night");
});

test("a member feed serves that member's events and is privately cached", async ({
  request,
}) => {
  const token = seedSubscription(`e2e-feed-${Date.now()}@example.com`);
  seedEvent("Feed members meeting", "members");

  const response = await getFeed(request, `/api/calendar/${token}.ics`);

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("SUMMARY:Feed members meeting");

  // **The URL is a bearer credential**, so nothing shared may cache it.
  const cacheControl = response.headers()["cache-control"];
  expect(cacheControl).toMatch(/private/);
  expect(cacheControl).not.toMatch(/\bpublic\b/);
});

test("an unknown token answers 404, not 403", async ({ request }) => {
  const response = await getFeed(
    request,
    `/api/calendar/${crypto.randomUUID()}.ics`,
  );
  // 403 would confirm the token namespace and turn this into an oracle.
  expect(response.status()).toBe(404);
});

test("a revoked token stops working immediately", async ({ request }) => {
  const token = seedSubscription(`e2e-feed-revoke-${Date.now()}@example.com`);
  expect((await getFeed(request, `/api/calendar/${token}.ics`)).status()).toBe(
    200,
  );

  execD1(
    `UPDATE calendar_subscriptions SET revoked_at = ${Date.now()} WHERE token = '${token}'`,
  );

  expect((await getFeed(request, `/api/calendar/${token}.ics`)).status()).toBe(
    404,
  );
});

test("a malformed path answers 404 rather than erroring", async ({
  request,
}) => {
  for (const path of [
    "/api/calendar/not-an-ics-file",
    "/api/calendar/.ics",
    "/api/calendar/../secrets.ics",
  ]) {
    expect((await getFeed(request, path)).status()).toBe(404);
  }
});

test("fetching twice yields a 304 on the second request", async ({
  request,
}) => {
  seedEvent("Feed etag event", "public");

  const first = await getFeed(request, "/api/calendar/public.ics");
  const etag = first.headers().etag;
  expect(etag).toBeTruthy();

  /**
   * The assertion the ETag exists for, and the one that failed before
   * DTSTAMP was stripped from the hash: that property is set from the
   * clock on every render, so the tag changed every second and
   * `If-None-Match` matched only within a single second. Every client
   * re-downloaded the whole feed on every poll.
   */
  const second = await request.get(`${BASE}/api/calendar/public.ics`, {
    headers: { "If-None-Match": etag },
    failOnStatusCode: false,
  });
  expect(second.status()).toBe(304);
});

test("the kind filter narrows a member feed", async ({ request }) => {
  const token = seedSubscription(`e2e-feed-kind-${Date.now()}@example.com`);
  const title = `Feed kind meeting ${Date.now()}`;
  seedEvent(title, "members");

  const unfiltered = await (
    await getFeed(request, `/api/calendar/${token}.ics`)
  ).text();
  expect(unfiltered).toContain(title);

  // The seeded event is a `meeting`, so a trips-only feed must omit it.
  const filtered = await (
    await getFeed(request, `/api/calendar/${token}.ics?kind=trip`)
  ).text();
  expect(filtered).not.toContain(title);
  // ...and still be a valid calendar rather than an error.
  expect(filtered).toContain("BEGIN:VCALENDAR");
});

test("the feed flag gates the route independently of the page flag", async ({
  request,
}) => {
  // `calendar.feed_enabled` is a separate switch from `pages.calendar`
  // precisely so this can happen without 404ing the page.
  execD1(
    `INSERT INTO site_settings (key, value_json, updated_at)
     VALUES ('calendar.feed_enabled', 'false', ${Date.now()})
     ON CONFLICT(key) DO UPDATE SET value_json = 'false'`,
  );
  try {
    expect((await getFeed(request, "/api/calendar/public.ics")).status()).toBe(
      404,
    );
  } finally {
    // Restore, or every later spec in the run sees a dead feed.
    execD1(`DELETE FROM site_settings WHERE key = 'calendar.feed_enabled'`);
  }

  expect((await getFeed(request, "/api/calendar/public.ics")).status()).toBe(
    200,
  );
});

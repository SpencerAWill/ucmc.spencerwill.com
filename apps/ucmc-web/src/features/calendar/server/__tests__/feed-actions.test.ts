import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";
import {
  MEMBER_SCOPE,
  OFFICER_SCOPE,
  PUBLIC_SCOPE,
} from "#/server/events/events-repo.server";

// ── mocks ──────────────────────────────────────────────────────────────

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkUploadRateLimit: async () => true,
  checkCalendarFeedRateLimit: async () => true,
}));

const {
  buildFeedAction,
  createSubscriptionToken,
  resolveSubscriptionToken,
  scopeForSubscriber,
} = await import("#/features/calendar/server/feed-actions.server");
const { createEventAction, overrideOccurrenceAction, cancelEventAction } =
  await import("#/features/calendar/server/event-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

const NOW = Temporal.Instant.from("2026-05-01T12:00:00Z");

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

async function seedUser(email: string, status: "approved" | "pending") {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status,
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: Temporal.Now.instant(),
  });
  return id;
}

async function assignRole(userId: string, roleId: string) {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAsAdmin(email = "admin@example.com") {
  const userId = await seedUser(email, "approved");
  await assignRole(userId, "role_system_admin");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

const READER_ROLE = "role_test_feed_reader";

async function ensureReaderRole() {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: READER_ROLE,
      name: "test_feed_reader",
      displayName: "Test: feed private reader",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: READER_ROLE, permissionId: "perm_events_read_private" })
    .onConflictDoNothing();
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Weekly meeting",
    description: null,
    location: null,
    startsAt: clubLocal("2026-05-06T18:00"),
    endsAt: clubLocal("2026-05-06T19:00"),
    allDay: false,
    kind: "meeting" as const,
    visibility: "members" as const,
    rrule: null,
    ...overrides,
  };
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.eventExceptions);
  await db.delete(schema.events);
  await db.delete(schema.calendarSubscriptions);
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── tokens ─────────────────────────────────────────────────────────────

describe("subscription tokens", () => {
  it("resolves a minted token to its owner", async () => {
    const userId = await seedUser("tok@example.com", "approved");
    const { token } = await createSubscriptionToken(userId, "iPhone");
    expect(await resolveSubscriptionToken(token)).toBe(userId);
  });

  it("does not resolve an unknown token", async () => {
    expect(await resolveSubscriptionToken("not-a-real-token")).toBeNull();
  });

  /**
   * Revocation is the only thing standing between a leaked URL and a
   * member's calendar, so it has to take effect on the very next poll.
   */
  it("stops resolving once revoked", async () => {
    const userId = await seedUser("revoke@example.com", "approved");
    const { id, token } = await createSubscriptionToken(userId, null);
    await getDb()
      .update(schema.calendarSubscriptions)
      .set({ revokedAt: Temporal.Now.instant() })
      .where(eq(schema.calendarSubscriptions.id, id));

    expect(await resolveSubscriptionToken(token)).toBeNull();
  });

  /**
   * How "my calendar is stale" gets diagnosed: it answers whether the
   * client is polling at all, before anyone starts guessing about
   * caches.
   */
  it("stamps last_fetched_at on resolution", async () => {
    const userId = await seedUser("stamp@example.com", "approved");
    const { id, token } = await createSubscriptionToken(userId, null);

    const before = await getDb()
      .select({ at: schema.calendarSubscriptions.lastFetchedAt })
      .from(schema.calendarSubscriptions)
      .where(eq(schema.calendarSubscriptions.id, id));
    expect(before[0].at).toBeNull();

    await resolveSubscriptionToken(token);

    const after = await getDb()
      .select({ at: schema.calendarSubscriptions.lastFetchedAt })
      .from(schema.calendarSubscriptions)
      .where(eq(schema.calendarSubscriptions.id, id));
    expect(after[0].at).not.toBeNull();
  });

  it("mints distinct tokens per subscription", async () => {
    const userId = await seedUser("multi@example.com", "approved");
    const first = await createSubscriptionToken(userId, "Phone");
    const second = await createSubscriptionToken(userId, "Laptop");
    expect(first.token).not.toBe(second.token);
    expect(await resolveSubscriptionToken(second.token)).toBe(userId);
  });
});

describe("scopeForSubscriber", () => {
  it("gives an approved member the members tier", async () => {
    const userId = await seedUser("member@example.com", "approved");
    await assignRole(userId, "role_member");
    expect(await scopeForSubscriber(userId)).toEqual(MEMBER_SCOPE);
  });

  it("gives a holder of events:read_private the officers tier", async () => {
    await ensureReaderRole();
    const userId = await seedUser("exec@example.com", "approved");
    await assignRole(userId, READER_ROLE);
    expect(await scopeForSubscriber(userId)).toEqual(OFFICER_SCOPE);
  });

  it("gives a pending user the public tier", async () => {
    const userId = await seedUser("pending@example.com", "pending");
    expect(await scopeForSubscriber(userId)).toEqual(PUBLIC_SCOPE);
  });

  /**
   * **The revocation story for a subscription URL.** Scope is resolved
   * from the user's current permissions on every fetch rather than
   * baked into the token, so an officer who loses their role stops
   * seeing exec events on their next poll. Baking it in would leave a
   * former officer's phone receiving exec meetings indefinitely, with
   * nothing short of revoking their token to stop it.
   */
  it("follows a role change between fetches", async () => {
    await ensureReaderRole();
    const userId = await seedUser("demoted@example.com", "approved");
    await assignRole(userId, READER_ROLE);
    expect(await scopeForSubscriber(userId)).toEqual(OFFICER_SCOPE);

    await getDb()
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));

    expect(await scopeForSubscriber(userId)).toEqual(MEMBER_SCOPE);
  });
});

// ── feed contents ──────────────────────────────────────────────────────

describe("buildFeedAction", () => {
  async function seedEvents() {
    await signInAsAdmin("feed-admin@example.com");
    await createEventAction(
      makeEvent({ title: "Open house", visibility: "public" }),
    );
    await createEventAction(
      makeEvent({ title: "Club meeting", visibility: "members" }),
    );
    await createEventAction(
      makeEvent({ title: "Exec meeting", visibility: "officers" }),
    );
    cookieJar.clear();
  }

  it("gives the public feed public events only", async () => {
    await seedEvents();
    const { ics } = await buildFeedAction(PUBLIC_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain("SUMMARY:Open house");
    expect(ics).not.toContain("SUMMARY:Club meeting");
    expect(ics).not.toContain("SUMMARY:Exec meeting");
  });

  it("gives a member feed public and member events", async () => {
    await seedEvents();
    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain("SUMMARY:Open house");
    expect(ics).toContain("SUMMARY:Club meeting");
    expect(ics).not.toContain("SUMMARY:Exec meeting");
  });

  it("gives an officer feed everything", async () => {
    await seedEvents();
    const { ics } = await buildFeedAction(
      OFFICER_SCOPE,
      "UCMC",
      undefined,
      NOW,
    );
    expect(ics).toContain("SUMMARY:Exec meeting");
  });

  it("honours a kind filter, so separate subscriptions are possible", async () => {
    await signInAsAdmin("kind-feed@example.com");
    await createEventAction(makeEvent({ title: "A meeting", kind: "meeting" }));
    await createEventAction(makeEvent({ title: "A trip", kind: "trip" }));
    cookieJar.clear();

    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", ["trip"], NOW);
    expect(ics).toContain("SUMMARY:A trip");
    expect(ics).not.toContain("SUMMARY:A meeting");
  });

  /**
   * One VEVENT carrying the rule, not one per occurrence. An expanded
   * feed has a horizon, so a member who subscribes and never returns
   * stops seeing the weekly meeting the day it passes.
   */
  it("emits a recurring series as one VEVENT with its RRULE", async () => {
    await signInAsAdmin("recur-feed@example.com");
    await createEventAction(
      makeEvent({ title: "Weekly", rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    cookieJar.clear();

    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE");
  });

  it("emits EXDATE for a skipped occurrence", async () => {
    await signInAsAdmin("exdate-feed@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: clubLocal("2026-05-13T18:00"),
      canceled: true,
      title: null,
      description: null,
      location: null,
      startsAt: null,
      endsAt: null,
    });
    cookieJar.clear();

    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain(`EXDATE;TZID=${CLUB_TIME_ZONE}:20260513T180000`);
  });

  /**
   * A moved occurrence rides as a RECURRENCE-ID event under the same
   * UID, and must not repeat the series' rule — a client would read
   * that as a second infinite series.
   */
  it("emits a moved occurrence as a RECURRENCE-ID override", async () => {
    await signInAsAdmin("override-feed@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: clubLocal("2026-05-13T18:00"),
      canceled: false,
      title: "In the gym",
      description: null,
      location: null,
      startsAt: clubLocal("2026-05-13T20:00"),
      endsAt: clubLocal("2026-05-13T21:00"),
    });
    cookieJar.clear();

    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain(
      `RECURRENCE-ID;TZID=${CLUB_TIME_ZONE}:20260513T180000`,
    );
    expect(ics).toContain("SUMMARY:In the gym");
    expect(ics.match(/RRULE:FREQ=WEEKLY;BYDAY=WE/g)).toHaveLength(1);
  });

  /**
   * A cancelled event must be PUBLISHED as cancelled. Dropping it from
   * the feed reads to most clients as "no change", and it sits on the
   * subscriber's phone indefinitely.
   */
  it("publishes a cancelled series rather than omitting it", async () => {
    await signInAsAdmin("cancel-feed@example.com");
    const { publicId } = await createEventAction(makeEvent());
    await cancelEventAction({ publicId, canceled: true });
    cookieJar.clear();

    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain("SUMMARY:Weekly meeting");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("renders an empty but valid calendar when there is nothing on", async () => {
    const { ics } = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("feed ETag", () => {
  it("is stable for unchanged content", async () => {
    await signInAsAdmin("etag@example.com");
    await createEventAction(makeEvent());
    cookieJar.clear();

    const first = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    const second = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(first.etag).toBe(second.etag);
  });

  it("changes when an event changes", async () => {
    const userId = await signInAsAdmin("etag2@example.com");
    const { publicId } = await createEventAction(makeEvent());
    const before = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);

    await getDb()
      .update(schema.events)
      .set({ title: "Renamed", updatedBy: userId })
      .where(eq(schema.events.publicId, publicId));
    cookieJar.clear();

    const after = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(after.etag).not.toBe(before.etag);
  });

  /**
   * A `max(updated_at)` ETag would miss this: nothing's timestamp moves
   * when a row disappears, so subscribers would keep being handed a 304
   * and never learn the event is gone.
   */
  it("changes when an event is deleted", async () => {
    await signInAsAdmin("etag3@example.com");
    const { publicId } = await createEventAction(makeEvent());
    const before = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);

    await getDb()
      .delete(schema.events)
      .where(eq(schema.events.publicId, publicId));

    const after = await buildFeedAction(MEMBER_SCOPE, "UCMC", undefined, NOW);
    expect(after.etag).not.toBe(before.etag);
  });

  it("differs between scopes, so one viewer's 304 cannot leak another's feed", async () => {
    await signInAsAdmin("etag4@example.com");
    await createEventAction(makeEvent({ visibility: "officers" }));
    await createEventAction(
      makeEvent({ title: "Public one", visibility: "public" }),
    );
    cookieJar.clear();

    const publicFeed = await buildFeedAction(
      PUBLIC_SCOPE,
      "UCMC",
      undefined,
      NOW,
    );
    const officerFeed = await buildFeedAction(
      OFFICER_SCOPE,
      "UCMC",
      undefined,
      NOW,
    );
    expect(publicFeed.etag).not.toBe(officerFeed.etag);
  });
});

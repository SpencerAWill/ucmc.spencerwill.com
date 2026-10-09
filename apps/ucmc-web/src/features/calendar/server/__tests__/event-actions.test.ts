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
}));

const {
  cancelEventAction,
  clearOccurrenceOverrideAction,
  createEventAction,
  currentVisibilityScope,
  deleteEventAction,
  getCalendarEventAction,
  listCalendarOccurrencesAction,
  overrideOccurrenceAction,
  updateEventAction,
} = await import("#/features/calendar/server/event-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

function clubLocal(local: string): Temporal.Instant {
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
}

function wallTime(instant: Temporal.Instant): string {
  return instant
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDateTime()
    .toString();
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

async function signInAsMember(email = "member@example.com") {
  const userId = await seedUser(email, "approved");
  await assignRole(userId, "role_member");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

/**
 * A role carrying `events:read_private` but NOT `events:manage`.
 *
 * Built as its own role rather than by revoking a seeded grant:
 * storage isolation in the workers pool is per file, so deleting a
 * seeded `role_permissions` row leaks into every later test in the
 * file — the trap `sponsor-actions.test.ts` documents having fallen
 * into.
 */
const READER_ROLE = "role_test_events_reader";

async function signInAsPrivateReader(email = "exec@example.com") {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: READER_ROLE,
      name: "test_events_reader",
      displayName: "Test: events private reader",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: READER_ROLE, permissionId: "perm_events_read_private" })
    .onConflictDoNothing();
  const userId = await seedUser(email, "approved");
  await assignRole(userId, READER_ROLE);
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Weekly meeting",
    description: null,
    location: "Rec Center",
    startsAt: clubLocal("2026-05-06T18:00"),
    endsAt: clubLocal("2026-05-06T19:00"),
    allDay: false,
    kind: "meeting" as const,
    visibility: "members" as const,
    rrule: null,
    ...overrides,
  };
}

const WINDOW = {
  from: clubLocal("2026-05-01T00:00"),
  until: clubLocal("2026-06-01T00:00"),
};

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  // `event_exceptions` cascades from `events`, but delete it first
  // anyway: the order has to be safe if the FK is ever relaxed, and a
  // leaked exception row is invisible until an unrelated assertion
  // counts rows and finds one too many.
  await db.delete(schema.eventExceptions);
  await db.delete(schema.events);
  await db.delete(schema.auditLog);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

/** Internal row id for a public id — exceptions are keyed on it. */
async function eventRowId(publicId: string): Promise<string> {
  const rows = await getDb()
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.publicId, publicId));
  return rows[0]?.id ?? "";
}

/** Exception rows for one series, so an assertion cannot see another's. */
async function exceptionsFor(eventId: string) {
  return getDb()
    .select()
    .from(schema.eventExceptions)
    .where(eq(schema.eventExceptions.eventId, eventId));
}

// ── visibility ─────────────────────────────────────────────────────────

describe("visibility scope", () => {
  it("gives an anonymous viewer the public tier only", async () => {
    expect(await currentVisibilityScope()).toEqual(PUBLIC_SCOPE);
  });

  it("gives an approved member the members tier", async () => {
    await signInAsMember("scope-member@example.com");
    expect(await currentVisibilityScope()).toEqual(MEMBER_SCOPE);
  });

  it("gives a holder of events:read_private the officers tier", async () => {
    await signInAsPrivateReader("scope-exec@example.com");
    expect(await currentVisibilityScope()).toEqual(OFFICER_SCOPE);
  });

  /**
   * A pending registrant is signed in but not yet a member. They must
   * land on the public tier, not the member one — approval is what
   * `members` means.
   */
  it("gives a pending user the public tier despite a session", async () => {
    const userId = await seedUser("pending@example.com", "pending");
    cookieJar.clear();
    await openSession(userId);
    expect(await currentVisibilityScope()).toEqual(PUBLIC_SCOPE);
  });
});

describe("listCalendarOccurrencesAction visibility", () => {
  /**
   * The load-bearing test of the whole feature. An officer-only event
   * must be filtered in SQL, so it never reaches the payload of a page
   * a member can load — hiding it client-side would still ship it in
   * the SSR HTML, and would still put it in that member's phone the
   * moment they subscribed to their feed.
   */
  it("withholds an officers-only event from a member", async () => {
    await signInAsAdmin("vis-admin@example.com");
    await createEventAction(
      makeEvent({ title: "Exec meeting", visibility: "officers" }),
    );
    await createEventAction(
      makeEvent({ title: "Club meeting", visibility: "members" }),
    );
    await createEventAction(
      makeEvent({ title: "Open house", visibility: "public" }),
    );

    await signInAsMember("vis-member@example.com");
    const visible = await listCalendarOccurrencesAction(WINDOW);
    expect(visible.map((o) => o.title).sort()).toEqual([
      "Club meeting",
      "Open house",
    ]);
  });

  it("shows an officers-only event to a holder of events:read_private", async () => {
    await signInAsAdmin("vis-admin2@example.com");
    await createEventAction(
      makeEvent({ title: "Exec meeting", visibility: "officers" }),
    );

    await signInAsPrivateReader("vis-exec@example.com");
    const visible = await listCalendarOccurrencesAction(WINDOW);
    expect(visible.map((o) => o.title)).toContain("Exec meeting");
  });

  it("shows an anonymous viewer public events only", async () => {
    await signInAsAdmin("vis-admin3@example.com");
    await createEventAction(
      makeEvent({ title: "Members night", visibility: "members" }),
    );
    await createEventAction(
      makeEvent({ title: "Trail day", visibility: "public" }),
    );

    cookieJar.clear();
    const visible = await listCalendarOccurrencesAction(WINDOW);
    expect(visible.map((o) => o.title)).toEqual(["Trail day"]);
  });

  it("honours an explicit scope, for the token-authenticated feed", async () => {
    await signInAsAdmin("vis-admin4@example.com");
    await createEventAction(
      makeEvent({ title: "Exec only", visibility: "officers" }),
    );

    cookieJar.clear();
    const asOfficer = await listCalendarOccurrencesAction({
      ...WINDOW,
      scope: OFFICER_SCOPE,
    });
    expect(asOfficer.map((o) => o.title)).toEqual(["Exec only"]);
  });

  it("filters by kind when asked", async () => {
    await signInAsAdmin("kind-admin@example.com");
    await createEventAction(makeEvent({ title: "A meeting", kind: "meeting" }));
    await createEventAction(makeEvent({ title: "A social", kind: "social" }));

    const socials = await listCalendarOccurrencesAction({
      ...WINDOW,
      kinds: ["social"],
    });
    expect(socials.map((o) => o.title)).toEqual(["A social"]);
  });
});

// ── writes ─────────────────────────────────────────────────────────────

describe("write permissions", () => {
  it("refuses an anonymous create", async () => {
    cookieJar.clear();
    await expect(createEventAction(makeEvent())).rejects.toThrow(
      /Not signed in/,
    );
  });

  it("refuses a plain member's create", async () => {
    await signInAsMember("nowrite@example.com");
    await expect(createEventAction(makeEvent())).rejects.toThrow(
      /events:manage/,
    );
  });

  it("refuses a create from someone who can only read private events", async () => {
    await signInAsPrivateReader("readonly-exec@example.com");
    await expect(createEventAction(makeEvent())).rejects.toThrow(
      /events:manage/,
    );
  });
});

describe("createEventAction", () => {
  it("stores the event and records an audit row", async () => {
    const userId = await signInAsAdmin("create@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ title: "Gear night" }),
    );

    const stored = await getCalendarEventAction(publicId);
    expect(stored?.title).toBe("Gear night");
    expect(stored?.sequence).toBe(0);

    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, publicId));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("event.created");
    expect(audit[0].actorUserId).toBe(userId);
  });

  it("expands a recurring series across the window", async () => {
    await signInAsAdmin("recur@example.com");
    await createEventAction(
      makeEvent({ title: "Weekly", rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences.map((o) => wallTime(o.startsAt))).toEqual([
      "2026-05-06T18:00:00",
      "2026-05-13T18:00:00",
      "2026-05-20T18:00:00",
      "2026-05-27T18:00:00",
    ]);
    expect(occurrences.every((o) => o.rrule === "FREQ=WEEKLY;BYDAY=WE")).toBe(
      true,
    );
  });

  it("sorts occurrences from different series chronologically", async () => {
    await signInAsAdmin("sort@example.com");
    await createEventAction(
      makeEvent({ title: "Later", startsAt: clubLocal("2026-05-20T10:00") }),
    );
    await createEventAction(
      makeEvent({ title: "Earlier", startsAt: clubLocal("2026-05-04T10:00") }),
    );

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences.map((o) => o.title)).toEqual(["Earlier", "Later"]);
  });
});

describe("series identity on an occurrence", () => {
  /**
   * **Every occurrence carries the SERIES anchor**, not its own start.
   * The officer edit dialog seeds `starts_at` from this; seeding from
   * the occurrence silently re-anchored the whole series, so fixing a
   * typo on the May 13 instance of a January series deleted every
   * occurrence before May 13 — from the page and from DTSTART in every
   * subscriber's feed — and cleared every exception with it.
   */
  it("carries the anchor, not the occurrence's own start", async () => {
    await signInAsAdmin("anchor-carry@example.com");
    await createEventAction(makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }));

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences.length).toBeGreaterThan(1);
    for (const occurrence of occurrences) {
      expect(wallTime(occurrence.seriesStartsAt)).toBe("2026-05-06T18:00:00");
    }
    // ...while their own starts genuinely differ.
    expect(wallTime(occurrences[1].startsAt)).toBe("2026-05-13T18:00:00");
  });

  /**
   * The two cancellation flags stay apart, because the officer controls
   * read them separately: calling off a series and skipping one week
   * are different acts. Merged, a cancelled series made every
   * occurrence look individually cancelled, so the per-slot button
   * offered "put this one back" and cleared an override that was never
   * there.
   */
  it("reports a cancelled series without claiming the slot was skipped", async () => {
    await signInAsAdmin("flags-series@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await cancelEventAction({ publicId, canceled: true });

    const [occurrence] = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrence.seriesCanceled).toBe(true);
    expect(occurrence.occurrenceCanceled).toBe(false);
    expect(occurrence.canceled).toBe(true);
  });

  it("reports a skipped slot without claiming the series was cancelled", async () => {
    await signInAsAdmin("flags-slot@example.com");
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

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    const skipped = occurrences.find(
      (o) => wallTime(o.occurrenceStart) === "2026-05-13T18:00:00",
    );
    expect(skipped?.occurrenceCanceled).toBe(true);
    expect(skipped?.seriesCanceled).toBe(false);

    const untouched = occurrences.find(
      (o) => wallTime(o.occurrenceStart) === "2026-05-06T18:00:00",
    );
    expect(untouched?.occurrenceCanceled).toBe(false);
    expect(untouched?.seriesCanceled).toBe(false);
  });

  /** Moving an occurrence keeps its length. */
  it("shifts the end with the start when only the start is overridden", async () => {
    await signInAsAdmin("shift-slot@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: clubLocal("2026-05-13T18:00"),
      canceled: false,
      title: null,
      description: null,
      location: null,
      startsAt: clubLocal("2026-05-13T20:00"),
      endsAt: null,
    });

    const moved = (await listCalendarOccurrencesAction(WINDOW)).find(
      (o) => wallTime(o.occurrenceStart) === "2026-05-13T18:00:00",
    );
    expect(wallTime(moved!.startsAt)).toBe("2026-05-13T20:00:00");
    expect(wallTime(moved!.endsAt!)).toBe("2026-05-13T21:00:00");
  });
});

describe("updateEventAction", () => {
  /**
   * SEQUENCE is RFC 5545's, and it is what clients compare to decide
   * whether an incoming VEVENT supersedes the copy they hold. A missed
   * bump means the edit silently never appears on anyone's calendar.
   */
  it("bumps SEQUENCE on every edit", async () => {
    await signInAsAdmin("seq@example.com");
    const { publicId } = await createEventAction(makeEvent());

    await updateEventAction({ ...makeEvent({ title: "Renamed" }), publicId });
    expect((await getCalendarEventAction(publicId))?.sequence).toBe(1);

    await updateEventAction({ ...makeEvent({ title: "Again" }), publicId });
    expect((await getCalendarEventAction(publicId))?.sequence).toBe(2);
  });

  it("applies the edit", async () => {
    await signInAsAdmin("edit@example.com");
    const { publicId } = await createEventAction(makeEvent());
    await updateEventAction({
      ...makeEvent({ title: "New title", location: "Crosley Tower" }),
      publicId,
    });

    const stored = await getCalendarEventAction(publicId);
    expect(stored?.title).toBe("New title");
    expect(stored?.location).toBe("Crosley Tower");
  });

  /**
   * An exception is filed under the slot the series generated, so
   * moving the anchor leaves it pointing at a slot that no longer
   * exists. Clearing is the honest outcome — silently re-pointing "no
   * meeting that week" would cancel an arbitrary different week.
   */
  it("clears exceptions when the anchor moves", async () => {
    await signInAsAdmin("anchor@example.com");
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

    await updateEventAction({
      ...makeEvent({
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startsAt: clubLocal("2026-05-07T18:00"),
        endsAt: clubLocal("2026-05-07T19:00"),
      }),
      publicId,
    });

    expect(await exceptionsFor(await eventRowId(publicId))).toHaveLength(0);
  });

  it("clears exceptions when the recurrence rule changes", async () => {
    await signInAsAdmin("rulechange@example.com");
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

    await updateEventAction({
      ...makeEvent({ rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE" }),
      publicId,
    });

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences.some((o) => o.canceled)).toBe(false);
  });
});

describe("cancelEventAction", () => {
  /**
   * A cancelled series stays in the result set. The page filters it,
   * but the feed has to publish STATUS:CANCELLED or subscribers' copies
   * never disappear — a row that merely stops being emitted reads to
   * most clients as "no change".
   */
  it("marks occurrences cancelled rather than removing them", async () => {
    await signInAsAdmin("cancel@example.com");
    const { publicId } = await createEventAction(makeEvent());
    await cancelEventAction({ publicId, canceled: true });

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].canceled).toBe(true);
  });

  it("un-cancels", async () => {
    await signInAsAdmin("uncancel@example.com");
    const { publicId } = await createEventAction(makeEvent());
    await cancelEventAction({ publicId, canceled: true });
    await cancelEventAction({ publicId, canceled: false });

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences[0].canceled).toBe(false);
  });

  it("bumps SEQUENCE so subscribers learn about it", async () => {
    await signInAsAdmin("cancelseq@example.com");
    const { publicId } = await createEventAction(makeEvent());
    await cancelEventAction({ publicId, canceled: true });
    expect((await getCalendarEventAction(publicId))?.sequence).toBe(1);
  });
});

describe("deleteEventAction", () => {
  it("removes the event and cascades its exceptions", async () => {
    await signInAsAdmin("delete@example.com");
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

    // Captured before the delete — afterwards there is no row to join through.
    const eventId = await eventRowId(publicId);
    await deleteEventAction({ publicId });

    expect(await getCalendarEventAction(publicId)).toBeNull();
    expect(await exceptionsFor(eventId)).toHaveLength(0);
  });
});

describe("occurrence overrides", () => {
  it("skips one occurrence of a series", async () => {
    await signInAsAdmin("skip@example.com");
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

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    const skipped = occurrences.filter((o) => o.canceled);
    expect(skipped.map((o) => wallTime(o.occurrenceStart))).toEqual([
      "2026-05-13T18:00:00",
    ]);
  });

  /**
   * A moved occurrence keeps its original `occurrenceStart` — that is
   * its RECURRENCE-ID, and it is what keeps the override addressable.
   */
  it("moves one occurrence while keeping its identity", async () => {
    await signInAsAdmin("move@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: clubLocal("2026-05-13T18:00"),
      canceled: false,
      title: "In the gym this week",
      description: null,
      location: "Campus Rec",
      startsAt: clubLocal("2026-05-13T20:00"),
      endsAt: clubLocal("2026-05-13T21:00"),
    });

    const moved = (await listCalendarOccurrencesAction(WINDOW)).find(
      (o) => wallTime(o.occurrenceStart) === "2026-05-13T18:00:00",
    );
    expect(moved).toBeDefined();
    expect(wallTime(moved!.startsAt)).toBe("2026-05-13T20:00:00");
    expect(moved!.title).toBe("In the gym this week");
    expect(moved!.location).toBe("Campus Rec");
  });

  /**
   * NULL on an override column means "inherit from the series", not
   * "unset" — so a later fix to the series title flows through to an
   * occurrence that was only moved.
   */
  it("inherits unset fields from the series", async () => {
    await signInAsAdmin("inherit@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ title: "Original", rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: clubLocal("2026-05-13T18:00"),
      canceled: false,
      title: null,
      description: null,
      location: null,
      startsAt: clubLocal("2026-05-13T20:00"),
      endsAt: null,
    });

    const moved = (await listCalendarOccurrencesAction(WINDOW)).find(
      (o) => wallTime(o.occurrenceStart) === "2026-05-13T18:00:00",
    );
    expect(moved!.title).toBe("Original");
  });

  it("replaces an existing override for the same slot", async () => {
    await signInAsAdmin("replace@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    const slot = clubLocal("2026-05-13T18:00");
    const base = {
      publicId,
      occurrenceStart: slot,
      description: null,
      location: null,
      startsAt: null,
      endsAt: null,
    };
    await overrideOccurrenceAction({ ...base, canceled: true, title: null });
    await overrideOccurrenceAction({
      ...base,
      canceled: false,
      title: "Back on",
    });

    const rows = await exceptionsFor(await eventRowId(publicId));
    expect(rows).toHaveLength(1);
    expect(rows[0].canceled).toBe(false);
    expect(rows[0].title).toBe("Back on");
  });

  it("clears an override, restoring the series", async () => {
    await signInAsAdmin("clear@example.com");
    const { publicId } = await createEventAction(
      makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
    );
    const slot = clubLocal("2026-05-13T18:00");
    await overrideOccurrenceAction({
      publicId,
      occurrenceStart: slot,
      canceled: true,
      title: null,
      description: null,
      location: null,
      startsAt: null,
      endsAt: null,
    });
    await clearOccurrenceOverrideAction({ publicId, occurrenceStart: slot });

    const occurrences = await listCalendarOccurrencesAction(WINDOW);
    expect(occurrences.some((o) => o.canceled)).toBe(false);
    expect(occurrences).toHaveLength(4);
  });

  it("bumps the series SEQUENCE, since overrides ride the parent feed entry", async () => {
    await signInAsAdmin("overseq@example.com");
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
    expect((await getCalendarEventAction(publicId))?.sequence).toBe(1);
  });
});

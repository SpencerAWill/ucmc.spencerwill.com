import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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
  createEventAction,
  createOpportunityAction,
  deleteEventAction,
  deleteOpportunityAction,
  getVolunteerContentAction,
  reorderOpportunitiesAction,
  updateEventAction,
  updateOpportunityAction,
} = await import("#/features/volunteer/server/volunteer-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
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

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

function makeOpportunity(title = "Trail work") {
  return {
    icon: "Shovel" as const,
    title,
    blurb: "Cut and clear approach trails.",
  };
}

/**
 * Midday Cincinnati-local on a fixed date, so "start of today" is
 * unambiguous and the DST offset is pinned rather than inherited from
 * whatever day the suite runs.
 */
const NOW = Temporal.Instant.from("2026-09-12T12:00:00-04:00");
const MS = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Red River Gorge trail day",
    partnerOrg: "RRGCC",
    location: "Slade, KY",
    startsAtMs: MS("2026-10-03T13:00:00Z"),
    endsAtMs: null,
    description: null,
    signupUrl: null,
    volunteersCount: null,
    serviceHours: null,
    albumTag: null,
    ...overrides,
  };
}

// Storage isolation in the workers pool is per file, not per test, so
// every table this suite writes has to be cleaned here — `auditLog`
// very much included, since each action appends to it.
beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.volunteerEvents);
  await db.delete(schema.volunteerOpportunities);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── permission gate ────────────────────────────────────────────────────

describe("public_volunteer:manage gate", () => {
  it("refuses every write from a plain member", async () => {
    await signInAsMember();
    await expect(createOpportunityAction(makeOpportunity())).rejects.toThrow(
      /public_volunteer:manage/,
    );
    await expect(
      updateOpportunityAction({ id: "vopp_x", ...makeOpportunity() }),
    ).rejects.toThrow(/public_volunteer:manage/);
    await expect(deleteOpportunityAction({ id: "vopp_x" })).rejects.toThrow(
      /public_volunteer:manage/,
    );
    await expect(
      reorderOpportunitiesAction({ ids: ["vopp_x"] }),
    ).rejects.toThrow(/public_volunteer:manage/);
    await expect(createEventAction(makeEvent())).rejects.toThrow(
      /public_volunteer:manage/,
    );
    await expect(
      updateEventAction({ id: "vevt_x", ...makeEvent() }),
    ).rejects.toThrow(/public_volunteer:manage/);
    await expect(deleteEventAction({ id: "vevt_x" })).rejects.toThrow(
      /public_volunteer:manage/,
    );
  });

  it("refuses writes when signed out", async () => {
    await expect(createOpportunityAction(makeOpportunity())).rejects.toThrow(
      /Not signed in/,
    );
  });

  it("leaves no audit rows behind when a write is refused", async () => {
    await signInAsMember();
    await expect(createOpportunityAction(makeOpportunity())).rejects.toThrow();
    const rows = await getDb().select().from(schema.auditLog);
    expect(rows).toHaveLength(0);
  });
});

// ── programs ───────────────────────────────────────────────────────────

describe("volunteer programs", () => {
  it("appends new programs to the end of the list", async () => {
    await signInAsAdmin();
    await createOpportunityAction(makeOpportunity("First"));
    await createOpportunityAction(makeOpportunity("Second"));
    const { opportunities } = await getVolunteerContentAction(NOW);
    expect(opportunities.map((o) => o.title)).toEqual(["First", "Second"]);
  });

  it("mints the next sort_order from MAX, not from the row count", async () => {
    await signInAsAdmin();
    const { id: first } = await createOpportunityAction(makeOpportunity("A"));
    await createOpportunityAction(makeOpportunity("B"));
    // Deleting the head makes count-based numbering collide with the
    // surviving row; MAX-based numbering keeps appending past it.
    await deleteOpportunityAction({ id: first });
    await createOpportunityAction(makeOpportunity("C"));
    const { opportunities } = await getVolunteerContentAction(NOW);
    expect(opportunities.map((o) => o.title)).toEqual(["B", "C"]);
  });

  it("rewrites sort_order densely on reorder", async () => {
    await signInAsAdmin();
    const a = await createOpportunityAction(makeOpportunity("A"));
    const b = await createOpportunityAction(makeOpportunity("B"));
    const c = await createOpportunityAction(makeOpportunity("C"));
    await reorderOpportunitiesAction({ ids: [c.id, a.id, b.id] });
    const { opportunities } = await getVolunteerContentAction(NOW);
    expect(opportunities.map((o) => o.title)).toEqual(["C", "A", "B"]);
    const rows = await getDb()
      .select({ sortOrder: schema.volunteerOpportunities.sortOrder })
      .from(schema.volunteerOpportunities);
    expect(rows.map((r) => r.sortOrder).sort()).toEqual([1, 2, 3]);
  });

  it("records one audit row per mutation, carrying the title", async () => {
    const actor = await signInAsAdmin();
    const { id } = await createOpportunityAction(
      makeOpportunity("Crag cleanup"),
    );
    await updateOpportunityAction({
      id,
      ...makeOpportunity("Crag cleanup day"),
    });
    await deleteOpportunityAction({ id });
    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, id));
    expect(rows.map((r) => r.action).sort()).toEqual([
      "volunteer_opportunity.created",
      "volunteer_opportunity.deleted",
      "volunteer_opportunity.updated",
    ]);
    expect(rows.every((r) => r.actorUserId === actor)).toBe(true);
    const deleted = rows.find(
      (r) => r.action === "volunteer_opportunity.deleted",
    );
    // The delete event carries the title the row had, so the audit
    // trail stays readable after the row itself is gone.
    expect(JSON.parse(deleted?.metadataJson ?? "{}").title).toBe(
      "Crag cleanup day",
    );
  });

  it("rejects a mutation against an id that isn't there", async () => {
    await signInAsAdmin();
    await expect(
      updateOpportunityAction({ id: "vopp_missing", ...makeOpportunity() }),
    ).rejects.toThrow(/not found/i);
    await expect(
      deleteOpportunityAction({ id: "vopp_missing" }),
    ).rejects.toThrow(/not found/i);
  });

  it("writes no audit row for a reorder of nothing", async () => {
    await signInAsAdmin();
    const result = await reorderOpportunitiesAction({ ids: [] });
    expect(result.count).toBe(0);
    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "volunteer_opportunity.reordered"));
    expect(rows).toHaveLength(0);
  });
});

// ── the upcoming / past split ──────────────────────────────────────────

describe("the day boundary between the two bands", () => {
  it("partitions events into exactly one band each", async () => {
    await signInAsAdmin();
    await createEventAction(
      makeEvent({ title: "Future", startsAtMs: MS("2026-10-03T13:00:00Z") }),
    );
    await createEventAction(
      makeEvent({ title: "Past", startsAtMs: MS("2026-04-11T13:00:00Z") }),
    );
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming.map((e) => e.title)).toEqual(["Future"]);
    expect(past.map((e) => e.title)).toEqual(["Past"]);
  });

  it("keeps an outing that started earlier today in Coming up", async () => {
    await signInAsAdmin();
    // 09:00 Cincinnati-local on the same day NOW sits at midday. A
    // naive `starts_at >= now` would have already moved this to the
    // archive while people are still driving to it.
    await createEventAction(
      makeEvent({
        title: "This morning",
        startsAtMs: MS("2026-09-12T09:00:00-04:00"),
      }),
    );
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming.map((e) => e.title)).toEqual(["This morning"]);
    expect(past).toHaveLength(0);
  });

  it("moves yesterday's outing to the archive", async () => {
    await signInAsAdmin();
    await createEventAction(
      makeEvent({
        title: "Yesterday",
        startsAtMs: MS("2026-09-11T23:00:00-04:00"),
      }),
    );
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming).toHaveLength(0);
    expect(past.map((e) => e.title)).toEqual(["Yesterday"]);
  });

  it("reads the boundary in Cincinnati, not UTC", async () => {
    await signInAsAdmin();
    // 22:00 EDT on the 11th is 02:00 UTC on the 12th. Computing the
    // day boundary in UTC would call this "today" and leave it in
    // Coming up; in America/New_York it is yesterday.
    await createEventAction(
      makeEvent({
        title: "Late last night",
        startsAtMs: MS("2026-09-12T02:00:00Z"),
      }),
    );
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming).toHaveLength(0);
    expect(past.map((e) => e.title)).toEqual(["Late last night"]);
  });

  it("orders upcoming soonest-first and the archive newest-first", async () => {
    await signInAsAdmin();
    await createEventAction(
      makeEvent({ title: "Later", startsAtMs: MS("2026-11-01T13:00:00Z") }),
    );
    await createEventAction(
      makeEvent({ title: "Sooner", startsAtMs: MS("2026-09-20T13:00:00Z") }),
    );
    await createEventAction(
      makeEvent({ title: "Older", startsAtMs: MS("2025-03-01T13:00:00Z") }),
    );
    await createEventAction(
      makeEvent({ title: "Newer", startsAtMs: MS("2026-05-01T13:00:00Z") }),
    );
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming.map((e) => e.title)).toEqual(["Sooner", "Later"]);
    expect(past.map((e) => e.title)).toEqual(["Newer", "Older"]);
  });

  it("moves an outing between bands when its start date is edited", async () => {
    await signInAsAdmin();
    const { id } = await createEventAction(
      makeEvent({
        title: "Rescheduled",
        startsAtMs: MS("2026-10-03T13:00:00Z"),
      }),
    );
    await updateEventAction({
      id,
      ...makeEvent({
        title: "Rescheduled",
        startsAtMs: MS("2026-01-10T13:00:00Z"),
      }),
    });
    const { upcoming, past } = await getVolunteerContentAction(NOW);
    expect(upcoming).toHaveLength(0);
    expect(past.map((e) => e.title)).toEqual(["Rescheduled"]);
  });
});

// ── outings ────────────────────────────────────────────────────────────

describe("volunteer outings", () => {
  it("round-trips every field, keeping unrecorded numbers null", async () => {
    await signInAsAdmin();
    await createEventAction(
      makeEvent({
        title: "Highway cleanup",
        partnerOrg: "Keep Cincinnati Beautiful",
        location: "Clifton",
        startsAtMs: MS("2026-10-03T13:00:00Z"),
        endsAtMs: MS("2026-10-03T17:00:00Z"),
        description: "Bring gloves.",
        signupUrl: "https://example.org/signup",
        albumTag: "Cleanup 2026",
      }),
    );
    const { upcoming } = await getVolunteerContentAction(NOW);
    const [event] = upcoming;
    expect(event).toMatchObject({
      title: "Highway cleanup",
      partnerOrg: "Keep Cincinnati Beautiful",
      location: "Clifton",
      description: "Bring gloves.",
      signupUrl: "https://example.org/signup",
      albumTag: "Cleanup 2026",
      // Not filled in until after the outing happens.
      volunteersCount: null,
      serviceHours: null,
    });
    expect(event.startsAtMs).toBe(MS("2026-10-03T13:00:00Z"));
    expect(event.endsAtMs).toBe(MS("2026-10-03T17:00:00Z"));
    expect(event.publicId).toHaveLength(12);
  });

  it("mints a distinct publicId per outing", async () => {
    await signInAsAdmin();
    const a = await createEventAction(makeEvent({ title: "A" }));
    const b = await createEventAction(makeEvent({ title: "B" }));
    expect(a.publicId).not.toBe(b.publicId);
  });

  it("stamps createdBy and updatedBy with the acting officer", async () => {
    const author = await signInAsAdmin("author@example.com");
    const { id } = await createEventAction(makeEvent());
    const editor = await signInAsAdmin("editor@example.com");
    await updateEventAction({ id, ...makeEvent({ title: "Edited" }) });
    const rows = await getDb()
      .select({
        createdBy: schema.volunteerEvents.createdBy,
        updatedBy: schema.volunteerEvents.updatedBy,
      })
      .from(schema.volunteerEvents)
      .where(eq(schema.volunteerEvents.id, id));
    expect(rows[0]).toEqual({ createdBy: author, updatedBy: editor });
  });

  it("carries the start date in audit metadata", async () => {
    await signInAsAdmin();
    const { id } = await createEventAction(makeEvent());
    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "volunteer_event.created"));
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0]?.metadataJson ?? "{}");
    // The start date is what decides which band the row renders in, so
    // an audit row without it can't explain where the outing went.
    expect(meta.startsAtMs).toBe(MS("2026-10-03T13:00:00Z"));
    expect(rows[0]?.targetId).toBe(id);
  });

  it("rejects a mutation against an id that isn't there", async () => {
    await signInAsAdmin();
    await expect(
      updateEventAction({ id: "vevt_missing", ...makeEvent() }),
    ).rejects.toThrow(/not found/i);
    await expect(deleteEventAction({ id: "vevt_missing" })).rejects.toThrow(
      /not found/i,
    );
  });
});

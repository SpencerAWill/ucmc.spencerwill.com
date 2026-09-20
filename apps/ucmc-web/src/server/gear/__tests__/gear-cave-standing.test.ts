import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";

// ── mocks ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
  setCookie: () => undefined,
  deleteCookie: () => undefined,
  getRequestHeader: () => undefined,
}));

const { gearCaveStanding } =
  await import("#/server/gear/gear-cave-standing.server");

const TZ = "America/New_York";

/** Fixed so the assertions read as calendar arithmetic, not clock drift.
 *  Mid-afternoon Cincinnati time on a Wednesday — the cave's checkout
 *  night, which is exactly when standing gets consulted. */
const NOW = Temporal.Instant.from("2026-09-16T19:00:00Z");

function daysBefore(days: number): Temporal.Instant {
  // Due dates are stamped at end-of-day club time by `computeDueAt`, so
  // the fixture mirrors that rather than subtracting raw 24h blocks.
  return NOW.toZonedDateTimeISO(TZ)
    .subtract({ days })
    .with({ hour: 23, minute: 59, second: 59, millisecond: 999 })
    .toInstant();
}

let memberId: string;

async function seedLoan(dueAt: Temporal.Instant, returned: boolean) {
  const db = getDb();
  const itemId = `gi_${crypto.randomUUID()}`;
  await db.insert(schema.gearItems).values({
    id: itemId,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    modelId: MODEL_ID,
    code: crypto.randomUUID().slice(0, 8),
    condition: "serviceable",
  });
  await db.insert(schema.gearLoans).values({
    id: `gl_${crypto.randomUUID()}`,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    itemId,
    modelId: null,
    quantity: 1,
    memberUserId: memberId,
    checkedOutAt: daysBefore(60),
    dueAt,
    returnedAt: returned ? NOW : null,
  });
}

const TYPE_ID = "gt_standing_fixture";
const MODEL_ID = "gm_standing_fixture";

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.siteSettings);
  await db.delete(schema.users);

  memberId = `u_${crypto.randomUUID()}`;
  await db.insert(schema.users).values({
    id: memberId,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await db.insert(schema.gearTypes).values({
    id: TYPE_ID,
    publicId: "standingtype",
    name: "Standing fixture type",
  });
  await db.insert(schema.gearModels).values({
    id: MODEL_ID,
    publicId: "standingmodl",
    typeId: TYPE_ID,
    name: "Standing fixture model",
    tracking: "coded",
  });
});

describe("gearCaveStanding", () => {
  it("is good with no loans at all", async () => {
    const result = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(result.standing).toBe("good");
    expect(result.overdue).toEqual([]);
    expect(result.worstDaysOverdue).toBe(0);
  });

  it("is good while a loan is merely open, not yet due", async () => {
    await seedLoan(NOW.add({ hours: 48 }), false);
    const result = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(result.standing).toBe("good");
  });

  it("ignores returned loans however late they were", async () => {
    // Standing is about what the member is still holding. Punishing a
    // past return would make bringing gear back pointless.
    await seedLoan(daysBefore(90), true);
    const result = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(result.standing).toBe("good");
    expect(result.worstDaysOverdue).toBe(0);
  });

  it("flags at the flag threshold and blocks at the block threshold", async () => {
    await seedLoan(daysBefore(8), false);
    const flagged = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(flagged.standing).toBe("flagged");
    expect(flagged.worstDaysOverdue).toBe(8);
    expect(flagged.flagAfterDays).toBe(7);
    expect(flagged.blockAfterDays).toBe(21);

    await seedLoan(daysBefore(30), false);
    const blocked = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(blocked.standing).toBe("blocked");
    // Worst-first ordering: the desk should name the oldest offender.
    expect(blocked.worstDaysOverdue).toBe(30);
    expect(blocked.overdue.map((o) => o.days)).toEqual([30, 8]);
  });

  it("honours thresholds changed at runtime, without a migration", async () => {
    await seedLoan(daysBefore(3), false);
    const before = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(before.standing).toBe("good");

    await getDb()
      .insert(schema.siteSettings)
      .values({
        key: "gear.overdueFlagDays",
        valueJson: JSON.stringify(2),
        updatedBy: null,
      });
    const after = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(after.standing).toBe("flagged");
  });

  it("counts whole club days, not elapsed hours", async () => {
    // Due at 23:59:59 last night, checked at 15:00 today: that is one
    // calendar day overdue even though under 24 hours have passed. The
    // member's mental model is the calendar, and reading the field off a
    // raw instant would also make the worker (UTC) and the browser
    // disagree.
    await seedLoan(daysBefore(1), false);
    const result = await gearCaveStanding({
      memberUserId: memberId,
      now: NOW,
      timeZone: TZ,
    });
    expect(result.worstDaysOverdue).toBe(1);
  });
});

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
}));

const { createGearAction, listGearAction } =
  await import("#/features/gear/server/gear-actions.server");
const { createGearTypeAction } =
  await import("#/features/gear/server/gear-types-actions.server");
const { createGearModelAction } =
  await import("#/features/gear/server/models-actions.server");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

async function signInAsManager(): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      status: "approved",
    });
  await attachPrimaryEmail(id, `${crypto.randomUUID()}@example.com`);
  await getDb()
    .insert(schema.userRoles)
    .values({ userId: id, roleId: "role_system_admin" })
    .onConflictDoNothing();
  cookieJar.clear();
  await openSession(id);
  return id;
}

let typePublicId: string;

/** One type carrying the cadence, so the fallback from model to type is
 *  exercised by every row that doesn't override it. */
async function seedType(inspectionIntervalDays: number | null) {
  const type = await createGearTypeAction({
    name: `Rope ${crypto.randomUUID()}`,
    prefix: "R",
    description: null,
    inspectionIntervalDays,
  });
  if (!type.ok) throw new Error("type failed");
  typePublicId = type.publicId;
}

async function seedModel(overrides: {
  serviceLifeYears?: number | null;
  inspectionIntervalDays?: number | null;
}) {
  const model = await createGearModelAction({
    typePublicId,
    name: `Mammut ${crypto.randomUUID()}`,
    manufacturer: null,
    description: null,
    tracking: "coded",
    msrpCents: null,
    serviceLifeYears: overrides.serviceLifeYears ?? null,
    inspectionIntervalDays: overrides.inspectionIntervalDays ?? null,
    productUrl: null,
  });
  if (!model.ok) throw new Error("model failed");
  return model.publicId;
}

async function seedItem(
  modelPublicId: string,
  code: string,
  opts: { manufacturedAtMs?: number | null; inspectedDaysAgo?: number } = {},
) {
  const item = await createGearAction({
    modelPublicId,
    code,
    thumbnailDataUrl: null,
    acquiredAt: null,
    manufacturedAt: opts.manufacturedAtMs ?? null,
    acquisitionCostCents: null,
    notesMarkdown: null,
    condition: "serviceable",
    tagPublicIds: [],
  });
  if (!item.ok) throw new Error("item failed");
  if (opts.inspectedDaysAgo !== undefined) {
    const rows = await getDb()
      .select({ id: schema.gearItems.id })
      .from(schema.gearItems)
      .where(eq(schema.gearItems.publicId, item.publicId));
    await getDb()
      .insert(schema.gearInspections)
      .values({
        id: `gin_${crypto.randomUUID()}`,
        publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        itemId: rows.at(0)?.id ?? "",
        modelId: null,
        result: "pass",
        inspectedAt: Temporal.Instant.fromEpochMilliseconds(
          Date.now() - opts.inspectedDaysAgo * DAY_MS,
        ),
        inspectorUserId: null,
        notes: null,
      });
  }
  return item.publicId;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.gearInspections);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
});

describe("inspection filter", () => {
  it("agrees with the badge it sits next to", async () => {
    await signInAsManager();
    await seedType(180);
    const model = await seedModel({});
    await seedItem(model, "R-OK", { inspectedDaysAgo: 10 });
    await seedItem(model, "R-SOON", { inspectedDaysAgo: 170 });
    await seedItem(model, "R-LATE", { inspectedDaysAgo: 200 });
    await seedItem(model, "R-NEVER");

    // The SQL filter and the derived status are two implementations of
    // one rule; a disagreement shows as a row filtered to "overdue"
    // wearing an "inspection current" badge.
    for (const [filter, code] of [
      ["overdue", "R-LATE"],
      ["due_soon", "R-SOON"],
      ["never", "R-NEVER"],
    ] as const) {
      const result = await listGearAction({ inspection: filter });
      expect(result.rows.map((r) => r.code)).toEqual([code]);
      expect(result.rows[0]?.inspection.status).toBe(filter);
      expect(result.total).toBe(1);
    }

    const unfiltered = await listGearAction({});
    expect(
      unfiltered.rows.find((r) => r.code === "R-OK")?.inspection.status,
    ).toBe("ok");
  });

  it("falls back from the model's cadence to the type's", async () => {
    await signInAsManager();
    await seedType(180);
    const inherits = await seedModel({});
    const overrides = await seedModel({ inspectionIntervalDays: 3650 });
    await seedItem(inherits, "R-INHERIT", { inspectedDaysAgo: 200 });
    await seedItem(overrides, "R-OVERRIDE", { inspectedDaysAgo: 200 });
    // A model that needs looking at less often than its type is the
    // whole reason the override exists.
    const result = await listGearAction({ inspection: "overdue" });
    expect(result.rows.map((r) => r.code)).toEqual(["R-INHERIT"]);
  });

  it("reports gear with no cadence anywhere as untracked and filters it out", async () => {
    await signInAsManager();
    await seedType(null);
    const model = await seedModel({});
    await seedItem(model, "R-NOCADENCE");
    expect((await listGearAction({ inspection: "never" })).total).toBe(0);
    const all = await listGearAction({});
    expect(all.rows[0]?.inspection.status).toBe("untracked");
  });
});

describe("service life filter", () => {
  it("agrees with the badge it sits next to", async () => {
    await signInAsManager();
    await seedType(null);
    const model = await seedModel({ serviceLifeYears: 10 });
    const yearsAgoMs = (years: number) =>
      Temporal.Now.instant()
        .toZonedDateTimeISO("America/New_York")
        .subtract({ years })
        .toInstant().epochMilliseconds;
    await seedItem(model, "R-YOUNG", { manufacturedAtMs: yearsAgoMs(2) });
    // Nine years into a ten-year life: inside the one-year warning.
    await seedItem(model, "R-AGEING", { manufacturedAtMs: yearsAgoMs(9) });
    await seedItem(model, "R-DEAD", { manufacturedAtMs: yearsAgoMs(12) });
    await seedItem(model, "R-UNDATED");

    for (const [filter, code] of [
      ["expired", "R-DEAD"],
      ["expiring", "R-AGEING"],
      ["unknown", "R-UNDATED"],
    ] as const) {
      const result = await listGearAction({ serviceLife: filter });
      expect(result.rows.map((r) => r.code)).toEqual([code]);
      expect(result.rows[0]?.serviceLife.status).toBe(filter);
    }
  });

  it("leaves models with no service life out of every bucket", async () => {
    await signInAsManager();
    await seedType(null);
    const model = await seedModel({ serviceLifeYears: null });
    await seedItem(model, "R-FOREVER");
    for (const filter of ["expired", "expiring", "unknown"] as const) {
      expect((await listGearAction({ serviceLife: filter })).total).toBe(0);
    }
    // A carabiner that never ages out is not a gap in the records.
    expect((await listGearAction({})).rows[0]?.serviceLife.status).toBe(
      "untracked",
    );
  });

  it("keeps the total honest under paging", async () => {
    await signInAsManager();
    await seedType(null);
    const model = await seedModel({ serviceLifeYears: 5 });
    const old = Temporal.Now.instant()
      .toZonedDateTimeISO("America/New_York")
      .subtract({ years: 9 })
      .toInstant().epochMilliseconds;
    for (const code of ["R1", "R2", "R3"]) {
      await seedItem(model, code, { manufacturedAtMs: old });
    }
    // The filter is pushed into SQL rather than applied to a fetched
    // page, so a short page can't misreport the backlog's size.
    const page = await listGearAction({ serviceLife: "expired", perPage: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});

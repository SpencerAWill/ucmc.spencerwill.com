import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";
import type * as SponsorLogosModule from "#/server/r2/sponsor-logos.server";
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

// R2 is stubbed rather than exercised: what matters here is that the
// action stores a key, swaps it on replacement, and deletes the old one.
// The bytes themselves are `decodeImageDataUrl`'s business, which has
// its own coverage.
const putLogo = vi.fn(async (_key: string, _bytes: ArrayBuffer) => undefined);
const deleteLogo = vi.fn(async (_key: string) => undefined);
vi.mock("#/server/r2/sponsor-logos.server", async (importOriginal) => {
  const actual = await importOriginal<typeof SponsorLogosModule>();
  return {
    ...actual,
    putSponsorLogo: (key: string, bytes: ArrayBuffer) => putLogo(key, bytes),
    deleteSponsorLogo: (key: string) => deleteLogo(key),
  };
});

const {
  createSponsorAction,
  deleteSponsorAction,
  getSponsorsContentAction,
  reorderSponsorsAction,
  updateSponsorAction,
} = await import("#/features/sponsors/server/sponsor-actions.server");
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

/**
 * A role holding `public_sponsors:view` and nothing else.
 *
 * Built here rather than by revoking the seeded `role_member` grant:
 * storage isolation in the workers pool is per file, so deleting a
 * seeded `role_permissions` row leaks into every later test in the
 * suite — which is exactly what it did on the first run.
 */
const VIEW_ONLY_ROLE = "role_test_sponsors_view_only";

async function signInAsViewOnly(email = "viewonly@example.com") {
  const db = getDb();
  await db
    .insert(schema.roles)
    .values({
      id: VIEW_ONLY_ROLE,
      name: "test_sponsors_view_only",
      displayName: "Test: sponsors view only",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.rolePermissions)
    .values({
      roleId: VIEW_ONLY_ROLE,
      permissionId: "perm_public_sponsors_view",
    })
    .onConflictDoNothing();
  const userId = await seedUser(email);
  await assignRole(userId, VIEW_ONLY_ROLE);
  cookieJar.clear();
  await openSession(userId);
  return userId;
}

/**
 * The text fields only. `logo` is deliberately absent: on update it is a
 * three-state field where `undefined` means "leave the mark alone", so a
 * default of `null` here would silently clear the logo in every update
 * test — which is what it did on the first run.
 */
function makeSponsor(overrides: Record<string, unknown> = {}) {
  return {
    name: "Roads Rivers and Trails",
    blurb: "An outfitter that has kitted out UCMC trips for years.",
    websiteUrl: null,
    memberPerk: null,
    ...overrides,
  };
}

/** Create input — `logo` is required on create, nullable for "no mark". */
function makeCreate(overrides: Record<string, unknown> = {}) {
  return { ...makeSponsor(), logo: null, ...overrides };
}

/** The stored row, asserted present — every caller just created it. */
async function readSponsor(id: string) {
  const rows = await getDb()
    .select()
    .from(schema.sponsors)
    .where(eq(schema.sponsors.id, id));
  const row = rows.at(0);
  if (!row) {
    throw new Error(`No sponsor row for ${id}`);
  }
  return row;
}

// A 1×1 transparent WebP, as the client's canvas would emit it.
const WEBP_DATA_URL =
  "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function makeLogo() {
  return { dataUrl: WEBP_DATA_URL, widthPx: 320, heightPx: 96 };
}

// Storage isolation in the workers pool is per file, not per test, so
// every table this suite writes has to be cleaned here — `auditLog`
// very much included, since each action appends to it.
beforeEach(async () => {
  cookieJar.clear();
  putLogo.mockClear();
  deleteLogo.mockClear();
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.sponsors);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── permission gate ────────────────────────────────────────────────────

describe("public_sponsors:manage gate", () => {
  it("refuses every write from a plain member", async () => {
    await signInAsMember();
    await expect(createSponsorAction(makeCreate())).rejects.toThrow(
      /public_sponsors:manage/,
    );
    await expect(
      updateSponsorAction({ id: "spon_x", ...makeSponsor() }),
    ).rejects.toThrow(/public_sponsors:manage/);
    await expect(deleteSponsorAction({ id: "spon_x" })).rejects.toThrow(
      /public_sponsors:manage/,
    );
    await expect(reorderSponsorsAction({ ids: ["spon_x"] })).rejects.toThrow(
      /public_sponsors:manage/,
    );
  });

  it("refuses every write from a signed-out visitor", async () => {
    cookieJar.clear();
    await expect(createSponsorAction(makeCreate())).rejects.toThrow(
      /Not signed in/,
    );
  });
});

// ── the perk projection ────────────────────────────────────────────────
//
// The reason this feature has a third permission. `member_perk` holds a
// discount code on a page an anonymous visitor can load, so it must be
// absent from the payload rather than merely hidden by the client.

describe("member-only perk projection", () => {
  beforeEach(async () => {
    await signInAsAdmin();
    await createSponsorAction(
      makeCreate({ memberPerk: "15% off full-price gear" }),
    );
  });

  it("omits the perk entirely for a signed-out visitor", async () => {
    cookieJar.clear();
    const { sponsors, perksIncluded } = await getSponsorsContentAction();
    expect(perksIncluded).toBe(false);
    expect(sponsors).toHaveLength(1);
    // `not.toHaveProperty`, not `toBeNull`: `null` is a real value here
    // meaning "this sponsor offers no perk", so sending it as null would
    // still leak which sponsors have one.
    expect(sponsors[0]).not.toHaveProperty("memberPerk");
  });

  it("omits the perk for an approved user without the grant", async () => {
    // Holds `public_sponsors:view` but not `:perks`, which proves the
    // projection follows the permission rather than the account status —
    // the whole reason perks are a third permission instead of an
    // "is this an approved member" test.
    await signInAsViewOnly();
    const { sponsors, perksIncluded } = await getSponsorsContentAction();
    expect(perksIncluded).toBe(false);
    expect(sponsors[0]).not.toHaveProperty("memberPerk");
  });

  it("includes the perk for a member holding public_sponsors:perks", async () => {
    await signInAsMember();
    const { sponsors, perksIncluded } = await getSponsorsContentAction();
    expect(perksIncluded).toBe(true);
    expect(sponsors[0]?.memberPerk).toBe("15% off full-price gear");
  });

  it("keeps the public columns identical either way", async () => {
    await signInAsMember();
    const asMember = await getSponsorsContentAction();
    cookieJar.clear();
    const asAnon = await getSponsorsContentAction();
    const strip = (entry: SponsorEntry | undefined) => {
      if (!entry) {
        throw new Error("Expected a sponsor row");
      }
      const { memberPerk: _perk, ...rest } = entry;
      return rest;
    };
    expect(strip(asAnon.sponsors[0])).toEqual(strip(asMember.sponsors[0]));
  });

  it("never copies the perk text into the audit trail", async () => {
    const rows = await getDb()
      .select({ metadataJson: schema.auditLog.metadataJson })
      .from(schema.auditLog);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("15% off");
    // The *presence* of a perk is recorded; the text is not.
    expect(serialized).toContain("hasPerk");
  });
});

// ── CRUD ───────────────────────────────────────────────────────────────

describe("sponsor CRUD", () => {
  beforeEach(async () => {
    await signInAsAdmin();
  });

  it("creates a sponsor at the end of the list and audits it", async () => {
    await createSponsorAction(makeCreate({ name: "First" }));
    const { id } = await createSponsorAction(makeCreate({ name: "Second" }));

    const rows = await getDb()
      .select({
        name: schema.sponsors.name,
        sortOrder: schema.sponsors.sortOrder,
      })
      .from(schema.sponsors);
    expect(rows.find((r) => r.name === "First")?.sortOrder).toBe(1);
    expect(rows.find((r) => r.name === "Second")?.sortOrder).toBe(2);

    const audit = await getDb()
      .select({
        action: schema.auditLog.action,
        targetId: schema.auditLog.targetId,
      })
      .from(schema.auditLog);
    expect(audit).toContainEqual({ action: "sponsor.created", targetId: id });
  });

  it("rejects an update to an id that doesn't exist", async () => {
    await expect(
      updateSponsorAction({ id: "spon_missing", ...makeSponsor() }),
    ).rejects.toThrow(/not found/i);
  });

  it("deletes a sponsor and names it in the audit row", async () => {
    const { id } = await createSponsorAction(makeCreate({ name: "Ale-8-One" }));
    await deleteSponsorAction({ id });
    expect(await getDb().select().from(schema.sponsors)).toHaveLength(0);
    const audit = await getDb()
      .select({
        action: schema.auditLog.action,
        metadataJson: schema.auditLog.metadataJson,
      })
      .from(schema.auditLog);
    const row = audit.find((a) => a.action === "sponsor.deleted");
    expect(row?.metadataJson ?? "").toContain("Ale-8-One");
  });

  it("refuses to delete an id that's already gone", async () => {
    // `.returning()` proves a row went away, so a repeat delete doesn't
    // write a second, misleading audit row.
    await expect(deleteSponsorAction({ id: "spon_missing" })).rejects.toThrow(
      /not found/i,
    );
  });

  it("renumbers sort_order densely on reorder", async () => {
    const a = await createSponsorAction(makeCreate({ name: "A" }));
    const b = await createSponsorAction(makeCreate({ name: "B" }));
    const c = await createSponsorAction(makeCreate({ name: "C" }));
    await reorderSponsorsAction({ ids: [c.id, a.id, b.id] });

    const { sponsors } = await getSponsorsContentAction();
    expect(sponsors.map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  it("mints a sort_order past the highest in use after a delete", async () => {
    const a = await createSponsorAction(makeCreate({ name: "A" }));
    await createSponsorAction(makeCreate({ name: "B" }));
    await createSponsorAction(makeCreate({ name: "C" }));
    // Delete the *first* row, which is the case that separates MAX + 1
    // from COUNT + 1: two rows remain at sort_order 2 and 3, so a count
    // would mint 3 and collide with C, leaving the tie broken
    // arbitrarily. MAX + 1 mints 4.
    await deleteSponsorAction({ id: a.id });
    await createSponsorAction(makeCreate({ name: "D" }));
    const rows = await getDb()
      .select({
        name: schema.sponsors.name,
        sortOrder: schema.sponsors.sortOrder,
      })
      .from(schema.sponsors);
    expect(rows.find((r) => r.name === "D")?.sortOrder).toBe(4);
    // And the order the page renders is still unambiguous.
    const { sponsors } = await getSponsorsContentAction();
    expect(sponsors.map((s) => s.name)).toEqual(["B", "C", "D"]);
  });
});

// ── logo lifecycle ─────────────────────────────────────────────────────

describe("sponsor logos", () => {
  beforeEach(async () => {
    await signInAsAdmin();
  });

  it("stores a logo under the sponsor's id and records its dimensions", async () => {
    const { id } = await createSponsorAction(makeCreate({ logo: makeLogo() }));
    expect(putLogo).toHaveBeenCalledTimes(1);
    const row = await readSponsor(id);
    expect(row.logoKey).toMatch(
      new RegExp(`^sponsors/${id}/[a-f0-9]{16}\\.webp$`),
    );
    expect(row.logoWidthPx).toBe(320);
    expect(row.logoHeightPx).toBe(96);
  });

  it("leaves the stored logo alone when `logo` is absent from an update", async () => {
    // The three-state contract: undefined means "copy edit, don't touch
    // the mark". Collapsing it with null would clear the logo on every
    // text edit.
    const { id } = await createSponsorAction(makeCreate({ logo: makeLogo() }));
    const before = await readSponsor(id);
    await updateSponsorAction({ id, ...makeSponsor({ name: "Renamed" }) });
    const after = await readSponsor(id);
    expect(after.logoKey).toBe(before.logoKey);
    expect(deleteLogo).not.toHaveBeenCalled();
  });

  it("clears the logo when `logo` is explicitly null", async () => {
    const { id } = await createSponsorAction(makeCreate({ logo: makeLogo() }));
    const before = await readSponsor(id);
    await updateSponsorAction({ id, ...makeSponsor(), logo: null });
    const after = await readSponsor(id);
    expect(after.logoKey).toBeNull();
    expect(after.logoWidthPx).toBeNull();
    expect(deleteLogo).toHaveBeenCalledWith(before.logoKey);
  });

  it("deletes the sponsor's logo when the sponsor is deleted", async () => {
    const { id } = await createSponsorAction(makeCreate({ logo: makeLogo() }));
    const before = await readSponsor(id);
    await deleteSponsorAction({ id });
    expect(deleteLogo).toHaveBeenCalledWith(before.logoKey);
  });

  it("survives an R2 delete failure, leaving the orphan to the sweep", async () => {
    deleteLogo.mockRejectedValueOnce(new Error("R2 unavailable"));
    const { id } = await createSponsorAction(makeCreate({ logo: makeLogo() }));
    await expect(
      updateSponsorAction({ id, ...makeSponsor(), logo: null }),
    ).resolves.toEqual({ ok: true });
  });
});

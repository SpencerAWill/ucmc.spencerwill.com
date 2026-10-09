import { beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";

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

const { submitProfileFacetsAction } =
  await import("#/features/auth/server/profile-facets-actions.server");
const { loadProfileFacets } =
  await import("#/server/member-profile/profile-facets.server");
const { openSession } = await import("#/server/auth/session.server");

async function seedMember(email: string): Promise<string> {
  const db = getDb();
  const id = `user_${crypto.randomUUID()}`;
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    status: "approved",
  });
  await attachPrimaryEmail(id, email);
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Jordan Reyes",
    preferredName: "Jordan",
    phone: "+15135551234",
    ucAffiliation: "student",
  });
  return id;
}

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.profilePrompts);
  await db.delete(schema.profileDisciplines);
  await db.delete(schema.users);
  cookieJar.clear();
});

describe("submitProfileFacetsAction", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      submitProfileFacetsAction({ prompts: [], disciplines: [] }),
    ).rejects.toThrow();
  });

  it("round-trips prompts in the member's own order", async () => {
    // `position` is the member's ordering, and the profile reads it
    // back with an ORDER BY. Storing the array index is what makes
    // the two agree.
    const userId = await seedMember("facets-order@example.com");
    await openSession(userId);

    await submitProfileFacetsAction({
      prompts: [
        { key: "dream_objective", answer: "The Grand Teton." },
        { key: "trail_snack", answer: "Frozen Snickers." },
      ],
      disciplines: [],
    });

    const facets = await loadProfileFacets(userId);
    expect(facets.prompts).toEqual([
      { key: "dream_objective", answer: "The Grand Teton." },
      { key: "trail_snack", answer: "Frozen Snickers." },
    ]);

    const rows = await getDb()
      .select({ position: schema.profilePrompts.position })
      .from(schema.profilePrompts)
      .where(eq(schema.profilePrompts.userId, userId))
      .orderBy(asc(schema.profilePrompts.position));
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("replaces the previous set rather than adding to it", async () => {
    // Delete-then-insert, so a prompt the member removed is gone
    // rather than left behind at its old position.
    const userId = await seedMember("facets-replace@example.com");
    await openSession(userId);

    await submitProfileFacetsAction({
      prompts: [
        { key: "trail_snack", answer: "Frozen Snickers." },
        { key: "hot_take", answer: "Hammocks win." },
      ],
      disciplines: [{ discipline: "climbing", level: "comfortable" }],
    });
    await submitProfileFacetsAction({
      prompts: [{ key: "hot_take", answer: "Hammocks still win." }],
      disciplines: [{ discipline: "caving", level: "new" }],
    });

    const facets = await loadProfileFacets(userId);
    expect(facets.prompts).toEqual([
      { key: "hot_take", answer: "Hammocks still win." },
    ]);
    expect(facets.disciplines).toEqual([
      { discipline: "caving", level: "new" },
    ]);
  });

  it("clears everything when both lists are empty", async () => {
    // The two deletes are unconditional for exactly this case: a
    // member emptying their profile must not be a no-op.
    const userId = await seedMember("facets-clear@example.com");
    await openSession(userId);

    await submitProfileFacetsAction({
      prompts: [{ key: "trail_snack", answer: "Frozen Snickers." }],
      disciplines: [{ discipline: "climbing", level: "new" }],
    });
    await submitProfileFacetsAction({ prompts: [], disciplines: [] });

    expect(await loadProfileFacets(userId)).toEqual({
      prompts: [],
      disciplines: [],
    });
  });

  it("writes only the caller's rows", async () => {
    const mine = await seedMember("facets-mine@example.com");
    const theirs = await seedMember("facets-theirs@example.com");
    await openSession(theirs);
    await submitProfileFacetsAction({
      prompts: [{ key: "pack_item", answer: "Spare socks." }],
      disciplines: [],
    });

    await openSession(mine);
    await submitProfileFacetsAction({ prompts: [], disciplines: [] });

    // Clearing mine must not clear theirs — the delete is scoped by
    // the principal, not global.
    const other = await loadProfileFacets(theirs);
    expect(other.prompts).toHaveLength(1);
  });
});

describe("loadProfileFacets", () => {
  it("drops rows whose key has left the registry", async () => {
    // A retired prompt's answers stay on disk so restoring the
    // prompt restores them, but they must not reach the page as an
    // undefined lookup.
    const userId = await seedMember("facets-orphan@example.com");
    await getDb().insert(schema.profilePrompts).values({
      userId,
      promptKey: "a_prompt_that_was_removed",
      answer: "orphaned",
      position: 0,
    });
    await getDb().insert(schema.profileDisciplines).values({
      userId,
      discipline: "climbing",
      level: "a_level_that_was_removed",
    });

    expect(await loadProfileFacets(userId)).toEqual({
      prompts: [],
      disciplines: [],
    });
  });
});

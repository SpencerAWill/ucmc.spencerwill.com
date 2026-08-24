/**
 * Pure data access for landing-page content. No auth, no business logic
 * — actions enforce authorization. Each list returns rows in `sort_order`
 * ascending so callers don't need to re-sort.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";

import type { HeroPage } from "#/features/landing/lib/hero-pages";
import { getDb, schema } from "#/server/db";

// ── Settings (singleton key/value) ──────────────────────────────────────

export interface SettingRow {
  key: string;
  valueJson: string;
  updatedAt: Temporal.Instant;
}

export async function listSettings(): Promise<SettingRow[]> {
  const db = getDb();
  return db
    .select({
      key: schema.landingSettings.key,
      valueJson: schema.landingSettings.valueJson,
      updatedAt: schema.landingSettings.updatedAt,
    })
    .from(schema.landingSettings);
}

/**
 * One setting row, or null. Exists so a page-hero read fetches two keys
 * instead of the whole `landing_settings` table — `getLandingContent`
 * needs every row, a hero needs its own two.
 */
export async function getSetting(key: string): Promise<SettingRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      key: schema.landingSettings.key,
      valueJson: schema.landingSettings.valueJson,
      updatedAt: schema.landingSettings.updatedAt,
    })
    .from(schema.landingSettings)
    .where(eq(schema.landingSettings.key, key))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function upsertSetting(
  key: string,
  valueJson: string,
  updatedBy: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.landingSettings)
    .values({
      key,
      valueJson,
      updatedAt: Temporal.Now.instant(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: schema.landingSettings.key,
      set: {
        valueJson,
        updatedAt: Temporal.Now.instant(),
        updatedBy,
      },
    });
}

// ── Hero slides ─────────────────────────────────────────────────────────

/**
 * Slides for one page, in display order.
 *
 * Always page-scoped — there is deliberately no "all slides" read. Since
 * migration 0065 the table holds every page's slides, so an unscoped
 * list would silently render /album's images on /policies.
 */
export async function listHeroSlides(page: HeroPage) {
  const db = getDb();
  return db
    .select()
    .from(schema.heroSlides)
    .where(eq(schema.heroSlides.page, page))
    .orderBy(
      asc(schema.heroSlides.sortOrder),
      asc(schema.heroSlides.createdAt),
    );
}

/**
 * One slide by id. Ids are globally unique, so this isn't page-scoped —
 * callers that mutate read the row's own `page` back off it rather than
 * trusting a page passed alongside the id.
 */
export async function getHeroSlide(
  id: string,
): Promise<schema.HeroSlide | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.heroSlides)
    .where(eq(schema.heroSlides.id, id))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

// Computes `sort_order = COALESCE(MAX(sort_order), -1) + 1` inside
// the INSERT statement so the read+insert is one round-trip and the
// MAX→INSERT TOCTOU window goes away (concurrent inserts no longer
// collide on the same sort_order).
//
// Race-safety here assumes Cloudflare D1's single-primary write model:
// SQLite serializes writes, so two parallel inserts can't see the
// same MAX. If D1 ever moves to a multi-primary / active-active
// topology, this subquery could see a stale local MAX and two regions
// could pick the same next value — at that point sort_order needs a
// different generator (e.g. a counter row in `landing_settings` or a
// monotonic uuidv7-derived ordinal). All three landing tables
// (hero slides / FAQ items / activities) share this assumption.
export async function insertHeroSlide(input: {
  id: string;
  page: HeroPage;
  imageKey: string;
  alt: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.heroSlides).values({
    id: input.id,
    page: input.page,
    imageKey: input.imageKey,
    alt: input.alt,
    // The MAX subquery is scoped to the page, so each page's slides
    // number from 0 independently — an unscoped MAX would make a new
    // /album slide sort after every home slide ever added.
    sortOrder: sql<number>`COALESCE((SELECT MAX(${schema.heroSlides.sortOrder}) FROM ${schema.heroSlides} WHERE ${schema.heroSlides.page} = ${input.page}), -1) + 1`,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateHeroSlide(input: {
  id: string;
  imageKey?: string;
  alt: string;
}): Promise<void> {
  const db = getDb();
  const set: { alt: string; updatedAt: Temporal.Instant; imageKey?: string } = {
    alt: input.alt,
    updatedAt: Temporal.Now.instant(),
  };
  if (input.imageKey) {
    set.imageKey = input.imageKey;
  }
  await db
    .update(schema.heroSlides)
    .set(set)
    .where(eq(schema.heroSlides.id, input.id));
}

export async function deleteHeroSlide(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.heroSlides).where(eq(schema.heroSlides.id, id));
}

// Atomically reorder a contiguous batch of rows. Caller passes the new
// id-order; we assign sort_order = index for each id. IDs not in the
// list are left untouched. Uses D1's batch API (single transaction at the
// driver level) — Drizzle's `db.transaction` issues `BEGIN/COMMIT` SQL
// which workerd D1 rejects in favor of `state.storage.transaction()`.
export async function reorderHeroSlides(idsInOrder: string[]): Promise<void> {
  if (idsInOrder.length === 0) {
    return;
  }
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = idsInOrder.map((id, i) =>
    db
      .update(schema.heroSlides)
      .set({ sortOrder: i, updatedAt: now })
      .where(eq(schema.heroSlides.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
}

// ── FAQ items ───────────────────────────────────────────────────────────

export async function listFaqItems() {
  const db = getDb();
  return db
    .select()
    .from(schema.landingFaqItems)
    .orderBy(
      asc(schema.landingFaqItems.sortOrder),
      asc(schema.landingFaqItems.createdAt),
    );
}

export async function getFaqItem(
  id: string,
): Promise<schema.LandingFaqItem | null> {
  const rows = await getDb()
    .select()
    .from(schema.landingFaqItems)
    .where(eq(schema.landingFaqItems.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertFaqItem(input: {
  id: string;
  question: string;
  answer: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.landingFaqItems).values({
    id: input.id,
    question: input.question,
    answer: input.answer,
    sortOrder: sql<number>`COALESCE((SELECT MAX(${schema.landingFaqItems.sortOrder}) FROM ${schema.landingFaqItems}), -1) + 1`,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateFaqItem(input: {
  id: string;
  question: string;
  answer: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.landingFaqItems)
    .set({
      question: input.question,
      answer: input.answer,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.landingFaqItems.id, input.id));
}

export async function deleteFaqItem(id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.landingFaqItems)
    .where(eq(schema.landingFaqItems.id, id));
}

export async function countFaqItems(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.landingFaqItems);
  return rows[0]?.c ?? 0;
}

export async function reorderFaqItems(idsInOrder: string[]): Promise<void> {
  if (idsInOrder.length === 0) {
    return;
  }
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = idsInOrder.map((id, i) =>
    db
      .update(schema.landingFaqItems)
      .set({ sortOrder: i, updatedAt: now })
      .where(eq(schema.landingFaqItems.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
}

// ── Activities ──────────────────────────────────────────────────────────

export async function listActivities() {
  const db = getDb();
  return db
    .select()
    .from(schema.landingActivities)
    .orderBy(
      asc(schema.landingActivities.sortOrder),
      asc(schema.landingActivities.createdAt),
    );
}

export async function getActivity(
  id: string,
): Promise<schema.LandingActivity | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.landingActivities)
    .where(eq(schema.landingActivities.id, id))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function insertActivity(input: {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  imageKey: string | null;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.landingActivities).values({
    id: input.id,
    icon: input.icon,
    title: input.title,
    blurb: input.blurb,
    imageKey: input.imageKey,
    sortOrder: sql<number>`COALESCE((SELECT MAX(${schema.landingActivities.sortOrder}) FROM ${schema.landingActivities}), -1) + 1`,
    createdAt: now,
    updatedAt: now,
  });
}

// `imageKey` semantics: omit (undefined) to leave the column unchanged;
// pass `null` to clear it; pass a string to replace it.
export async function updateActivity(input: {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  imageKey?: string | null;
}): Promise<void> {
  const db = getDb();
  const set: {
    icon: string;
    title: string;
    blurb: string;
    updatedAt: Temporal.Instant;
    imageKey?: string | null;
  } = {
    icon: input.icon,
    title: input.title,
    blurb: input.blurb,
    updatedAt: Temporal.Now.instant(),
  };
  if (input.imageKey !== undefined) {
    set.imageKey = input.imageKey;
  }
  await db
    .update(schema.landingActivities)
    .set(set)
    .where(eq(schema.landingActivities.id, input.id));
}

export async function countActivitiesUsingImageKey(
  key: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.landingActivities)
    .where(eq(schema.landingActivities.imageKey, key));
  return rows[0]?.c ?? 0;
}

export async function deleteActivity(id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.landingActivities)
    .where(eq(schema.landingActivities.id, id));
}

export async function reorderActivities(idsInOrder: string[]): Promise<void> {
  if (idsInOrder.length === 0) {
    return;
  }
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = idsInOrder.map((id, i) =>
    db
      .update(schema.landingActivities)
      .set({ sortOrder: i, updatedAt: now })
      .where(eq(schema.landingActivities.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
}

// Used by image-cleanup to find any slides referencing an R2 key (so we
// don't delete bytes that are still in use, even though hashes make
// collisions improbable).
export async function countSlidesUsingImageKey(key: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.heroSlides)
    .where(eq(schema.heroSlides.imageKey, key));
  return rows[0]?.c ?? 0;
}

// Helper for tests: find an arbitrary slide by image_key.
export async function findSlidesByImageKeys(keys: string[]) {
  if (keys.length === 0) {
    return [];
  }
  const db = getDb();
  return db
    .select()
    .from(schema.heroSlides)
    .where(inArray(schema.heroSlides.imageKey, keys));
}

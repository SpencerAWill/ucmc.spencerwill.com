/**
 * Pure data access for announcements. No auth, no business logic — the
 * actions layer is responsible for authorization. Joins users + profiles
 * to project the author's display name and avatar key alongside each row.
 */
import { and, count, desc, eq, gt, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  publishedAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  createdBy: string | null;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
}

export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      body: schema.announcements.body,
      publishedAt: schema.announcements.publishedAt,
      updatedAt: schema.announcements.updatedAt,
      createdBy: schema.announcements.createdBy,
      authorEmail: schema.userEmails.email,
      authorFullName: schema.profiles.fullName,
      authorPreferredName: schema.profiles.preferredName,
      authorAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.users.id, schema.announcements.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.announcements.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.announcements.createdBy),
    )
    .orderBy(desc(schema.announcements.publishedAt));
  return rows;
}

export async function getAnnouncement(
  id: string,
): Promise<AnnouncementRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      body: schema.announcements.body,
      publishedAt: schema.announcements.publishedAt,
      updatedAt: schema.announcements.updatedAt,
      createdBy: schema.announcements.createdBy,
      authorEmail: schema.userEmails.email,
      authorFullName: schema.profiles.fullName,
      authorPreferredName: schema.profiles.preferredName,
      authorAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.users.id, schema.announcements.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.announcements.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.announcements.createdBy),
    )
    .where(eq(schema.announcements.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertAnnouncement(input: {
  id: string;
  title: string;
  body: string;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.announcements).values({
    id: input.id,
    title: input.title,
    body: input.body,
    createdBy: input.createdBy,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateAnnouncement(input: {
  id: string;
  title: string;
  body: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.announcements)
    .set({
      title: input.title,
      body: input.body,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.announcements.id, input.id));
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.announcements).where(eq(schema.announcements.id, id));
}

/**
 * Count announcements published after the user's last-read marker. A null
 * marker means they have never opened the page, so every announcement is
 * unread. A subquery keeps this to one D1 round-trip instead of two
 * (user lookup + count).
 *
 * COALESCE falls back to `-1` (not `0`) for the null marker / missing-
 * user case so that a hypothetical `published_at = 0` row still
 * satisfies the strict `>` comparison and counts as unread. The
 * timestamp column stores `unixepoch() * 1000` and never legitimately
 * lands on 0, but the `-1` sentinel keeps the "every announcement is
 * unread" semantics literal regardless of stored values. The missing-
 * user case isn't reachable from caller code today (only signed-in
 * users hit this), but the sentinel makes the contract explicit.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(schema.announcements)
    .where(
      gt(
        schema.announcements.publishedAt,
        sql`COALESCE((SELECT ${schema.users.lastReadAnnouncementsAt} FROM ${schema.users} WHERE ${schema.users.id} = ${userId}), -1)`,
      ),
    );
  return rows[0]?.value ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({ lastReadAnnouncementsAt: Temporal.Now.instant() })
    .where(eq(schema.users.id, userId));
}

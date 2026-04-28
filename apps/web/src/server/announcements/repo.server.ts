/**
 * Pure data access for announcements. No auth, no business logic — the
 * actions layer is responsible for authorization. Joins users + profiles
 * to project the author's display name and avatar key alongside each row.
 */
import { count, desc, eq, gt } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  publishedAt: Date;
  updatedAt: Date;
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
      authorEmail: schema.users.email,
      authorFullName: schema.profiles.fullName,
      authorPreferredName: schema.profiles.preferredName,
      authorAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.users.id, schema.announcements.createdBy))
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
      authorEmail: schema.users.email,
      authorFullName: schema.profiles.fullName,
      authorPreferredName: schema.profiles.preferredName,
      authorAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.users.id, schema.announcements.createdBy))
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
  const now = new Date();
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
      updatedAt: new Date(),
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
 * unread.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { lastReadAnnouncementsAt: true },
  });
  if (!user) {
    return 0;
  }
  const marker = user.lastReadAnnouncementsAt;
  const query = db.select({ value: count() }).from(schema.announcements);
  const rows = marker
    ? await query.where(gt(schema.announcements.publishedAt, marker))
    : await query;
  return rows[0]?.value ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({ lastReadAnnouncementsAt: new Date() })
    .where(eq(schema.users.id, userId));
}

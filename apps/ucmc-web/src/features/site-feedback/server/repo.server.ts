/**
 * Pure data access for feedback. No auth, no business logic — the actions
 * layer is responsible for authorization. Joins users + profiles to project
 * the submitter's display name and avatar key alongside each row.
 */
import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type {
  SiteFeedbackKind,
  SiteFeedbackStatus,
} from "#/features/site-feedback/server/limits";

export interface SiteFeedbackRow {
  id: string;
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  status: SiteFeedbackStatus;
  pageUrl: string | null;
  userAgent: string | null;
  createdBy: string | null;
  createdByPublicId: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
}

const baseSelect = {
  id: schema.siteFeedback.id,
  kind: schema.siteFeedback.kind,
  title: schema.siteFeedback.title,
  body: schema.siteFeedback.body,
  status: schema.siteFeedback.status,
  pageUrl: schema.siteFeedback.pageUrl,
  userAgent: schema.siteFeedback.userAgent,
  createdBy: schema.siteFeedback.createdBy,
  createdByPublicId: schema.users.publicId,
  githubIssueNumber: schema.siteFeedback.githubIssueNumber,
  githubIssueUrl: schema.siteFeedback.githubIssueUrl,
  createdAt: schema.siteFeedback.createdAt,
  updatedAt: schema.siteFeedback.updatedAt,
  authorEmail: schema.userEmails.email,
  authorFullName: schema.profiles.fullName,
  authorPreferredName: schema.profiles.preferredName,
  authorAvatarKey: schema.profiles.avatarKey,
};

export async function listAllSiteFeedback(): Promise<SiteFeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.siteFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteFeedback.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.siteFeedback.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.siteFeedback.createdBy),
    )
    .orderBy(desc(schema.siteFeedback.createdAt));
}

export async function listSiteFeedbackByUser(
  userId: string,
): Promise<SiteFeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.siteFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteFeedback.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.siteFeedback.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.siteFeedback.createdBy),
    )
    .where(eq(schema.siteFeedback.createdBy, userId))
    .orderBy(desc(schema.siteFeedback.createdAt));
}

export async function insertSiteFeedback(input: {
  id: string;
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.siteFeedback).values({
    id: input.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    status: "open",
    pageUrl: input.pageUrl,
    userAgent: input.userAgent,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateSiteFeedbackStatus(input: {
  id: string;
  status: SiteFeedbackStatus;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.siteFeedback)
    .set({ status: input.status, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.siteFeedback.id, input.id));
}

/** `count(*)` of one member's open rows, and how many of them have a GitHub issue. */
export async function countMySiteFeedback(
  userId: string,
): Promise<{ open: number; tracked: number }> {
  const [open] = await getDb()
    .select({ n: count() })
    .from(schema.siteFeedback)
    .where(
      and(
        eq(schema.siteFeedback.createdBy, userId),
        eq(schema.siteFeedback.status, "open"),
      ),
    );
  const [tracked] = await getDb()
    .select({ n: count() })
    .from(schema.siteFeedback)
    .where(
      and(
        eq(schema.siteFeedback.createdBy, userId),
        isNotNull(schema.siteFeedback.githubIssueNumber),
      ),
    );
  return { open: open.n, tracked: tracked.n };
}

/** `count(*)` of every member's open rows. */
export async function countOpenSiteFeedback(): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.siteFeedback)
    .where(eq(schema.siteFeedback.status, "open"));
  return row.n;
}

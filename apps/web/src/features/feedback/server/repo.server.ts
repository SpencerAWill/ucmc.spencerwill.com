/**
 * Pure data access for feedback. No auth, no business logic — the actions
 * layer is responsible for authorization. Joins users + profiles to project
 * the submitter's display name and avatar key alongside each row.
 */
import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type {
  FeedbackKind,
  FeedbackStatus,
} from "#/features/feedback/server/limits";

export interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  pageUrl: string | null;
  userAgent: string | null;
  createdBy: string | null;
  createdByPublicId: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
}

const baseSelect = {
  id: schema.feedback.id,
  kind: schema.feedback.kind,
  title: schema.feedback.title,
  body: schema.feedback.body,
  status: schema.feedback.status,
  pageUrl: schema.feedback.pageUrl,
  userAgent: schema.feedback.userAgent,
  createdBy: schema.feedback.createdBy,
  createdByPublicId: schema.users.publicId,
  githubIssueNumber: schema.feedback.githubIssueNumber,
  githubIssueUrl: schema.feedback.githubIssueUrl,
  createdAt: schema.feedback.createdAt,
  updatedAt: schema.feedback.updatedAt,
  authorEmail: schema.users.email,
  authorFullName: schema.profiles.fullName,
  authorPreferredName: schema.profiles.preferredName,
  authorAvatarKey: schema.profiles.avatarKey,
};

export async function listAllFeedback(): Promise<FeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.feedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.feedback.createdBy))
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.feedback.createdBy),
    )
    .orderBy(desc(schema.feedback.createdAt));
}

export async function listFeedbackByUser(
  userId: string,
): Promise<FeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.feedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.feedback.createdBy))
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.feedback.createdBy),
    )
    .where(eq(schema.feedback.createdBy, userId))
    .orderBy(desc(schema.feedback.createdAt));
}

export async function getUserPublicId(userId: string): Promise<string | null> {
  const db = getDb();
  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { publicId: true },
  });
  return row?.publicId ?? null;
}

export async function insertFeedback(input: {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.insert(schema.feedback).values({
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

export async function updateFeedbackStatus(input: {
  id: string;
  status: FeedbackStatus;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.feedback)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(schema.feedback.id, input.id));
}

export async function setGithubIssue(
  id: string,
  number: number,
  url: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.feedback)
    .set({
      githubIssueNumber: number,
      githubIssueUrl: url,
      updatedAt: new Date(),
    })
    .where(eq(schema.feedback.id, id));
}

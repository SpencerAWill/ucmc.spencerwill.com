/**
 * Pure data access for feedback. No auth, no business logic — the actions
 * layer is responsible for authorization. Joins users + profiles to project
 * the submitter's display name and avatar key alongside each row.
 */
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type {
  SiteFeedbackKind,
  SiteFeedbackState,
  SiteFeedbackStatus,
} from "#/features/site-feedback/server/limits";
import { siteFeedbackStateSql } from "#/features/site-feedback/server/triage-repo.server";

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
  state: SiteFeedbackState;
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
  state: siteFeedbackStateSql(),
  createdAt: schema.siteFeedback.createdAt,
  updatedAt: schema.siteFeedback.updatedAt,
  authorEmail: schema.userEmails.email,
  authorFullName: schema.profiles.fullName,
  authorPreferredName: schema.profiles.preferredName,
  authorAvatarKey: schema.profiles.avatarKey,
};

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
  screenshotKey?: string | null;
  screenshotBytes?: number | null;
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
    screenshotKey: input.screenshotKey ?? null,
    screenshotBytes: input.screenshotBytes ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

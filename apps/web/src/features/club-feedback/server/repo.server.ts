/**
 * Pure data access for club feedback. No auth, no business logic — the
 * actions layer is responsible for authorization and for stripping
 * submitter info when a row is flagged anonymous (the repo always
 * returns the joined identity columns; the actions layer redacts).
 *
 * Mirrors `features/feedback/server/repo.server.ts` shape minus the
 * GitHub mirror helpers, which club feedback never uses.
 */
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type {
  ClubFeedbackKind,
  ClubFeedbackStatus,
} from "#/features/club-feedback/server/limits";

export interface ClubFeedbackRow {
  id: string;
  kind: ClubFeedbackKind;
  title: string;
  body: string;
  status: ClubFeedbackStatus;
  anonymous: boolean;
  createdBy: string | null;
  createdByPublicId: string | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
}

const baseSelect = {
  id: schema.clubFeedback.id,
  kind: schema.clubFeedback.kind,
  title: schema.clubFeedback.title,
  body: schema.clubFeedback.body,
  status: schema.clubFeedback.status,
  anonymous: schema.clubFeedback.anonymous,
  createdBy: schema.clubFeedback.createdBy,
  createdByPublicId: schema.users.publicId,
  createdAt: schema.clubFeedback.createdAt,
  updatedAt: schema.clubFeedback.updatedAt,
  authorEmail: schema.userEmails.email,
  authorFullName: schema.profiles.fullName,
  authorPreferredName: schema.profiles.preferredName,
  authorAvatarKey: schema.profiles.avatarKey,
};

export async function listAllClubFeedback(): Promise<ClubFeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.clubFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.clubFeedback.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.clubFeedback.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.clubFeedback.createdBy),
    )
    .orderBy(desc(schema.clubFeedback.createdAt));
}

export async function listClubFeedbackByUser(
  userId: string,
): Promise<ClubFeedbackRow[]> {
  const db = getDb();
  return db
    .select(baseSelect)
    .from(schema.clubFeedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.clubFeedback.createdBy))
    .leftJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.clubFeedback.createdBy),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.clubFeedback.createdBy),
    )
    .where(eq(schema.clubFeedback.createdBy, userId))
    .orderBy(desc(schema.clubFeedback.createdAt));
}

export async function insertClubFeedback(input: {
  id: string;
  kind: ClubFeedbackKind;
  title: string;
  body: string;
  anonymous: boolean;
  createdBy: string;
}): Promise<void> {
  const db = getDb();
  const now = Temporal.Now.instant();
  await db.insert(schema.clubFeedback).values({
    id: input.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    status: "open",
    anonymous: input.anonymous,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateClubFeedbackStatus(input: {
  id: string;
  status: ClubFeedbackStatus;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.clubFeedback)
    .set({ status: input.status, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.clubFeedback.id, input.id));
}

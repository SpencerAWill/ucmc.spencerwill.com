/**
 * Reads the sparse profile rows a member fills in about themselves:
 * their answered prompts and their self-rated disciplines.
 *
 * Beside `member-stats.server.ts` in `src/server/member-profile/` for
 * the same reason — the member directory, the profile page and
 * `/my/profile` all want them, and features can't import each other.
 *
 * Rows whose key is no longer in the registry are dropped on read
 * rather than rendered. A prompt can be retired by deleting its
 * registry entry, and the orphaned answers then stop appearing
 * without a migration to chase them down; they stay on disk, so
 * putting the prompt back brings the answers back with it.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "#/server/db";
import * as schema from "../../../drizzle/schema";

import type {
  DisciplineKey,
  DisciplineLevel,
  ProfilePromptKey,
} from "./profile-prompt-registry";
import {
  isDisciplineKey,
  isDisciplineLevel,
  isProfilePromptKey,
} from "./profile-prompt-registry";

export interface ProfilePromptAnswer {
  key: ProfilePromptKey;
  answer: string;
}

export interface ProfileDisciplineRating {
  discipline: DisciplineKey;
  level: DisciplineLevel;
}

export interface ProfileFacets {
  /** In the member's own order. */
  prompts: ProfilePromptAnswer[];
  /** In registry order, not insertion order, so the grid is stable. */
  disciplines: ProfileDisciplineRating[];
}

export async function loadProfileFacets(
  userId: string,
): Promise<ProfileFacets> {
  const db = getDb();

  const [promptRows, disciplineRows] = await Promise.all([
    db
      .select({
        promptKey: schema.profilePrompts.promptKey,
        answer: schema.profilePrompts.answer,
      })
      .from(schema.profilePrompts)
      .where(eq(schema.profilePrompts.userId, userId))
      .orderBy(asc(schema.profilePrompts.position)),
    db
      .select({
        discipline: schema.profileDisciplines.discipline,
        level: schema.profileDisciplines.level,
      })
      .from(schema.profileDisciplines)
      .where(eq(schema.profileDisciplines.userId, userId)),
  ]);

  return {
    prompts: promptRows.flatMap((row) =>
      isProfilePromptKey(row.promptKey)
        ? [{ key: row.promptKey, answer: row.answer }]
        : [],
    ),
    disciplines: disciplineRows.flatMap((row) =>
      isDisciplineKey(row.discipline) && isDisciplineLevel(row.level)
        ? [{ discipline: row.discipline, level: row.level }]
        : [],
    ),
  };
}

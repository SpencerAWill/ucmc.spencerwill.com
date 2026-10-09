/**
 * Self-service writes for the two sparse profile tables: a member's
 * answered prompts and their self-rated disciplines.
 *
 * Its own action rather than part of `submitPublicProfileAction`
 * because those are columns on one row and these are rows in two
 * other tables — and because the edit surface is a separate form with
 * its own Save, the same split `/register/pending` already uses.
 *
 * **Replace-all, in one batch.** Delete-then-insert per table, same
 * shape as `submitDetailsAction` does for emergency contacts. A diff
 * would buy nothing here: the member is the only writer of their own
 * prompts, so there is no concurrent edit to merge with, and the
 * whole set arrives from one form.
 *
 * Not audited. The audit log records officer actions against the
 * club; a member rewording their own trail snack is noise in it —
 * the same call `notification-prefs` makes.
 */

import { eq } from "drizzle-orm";

import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb } from "#/server/db";
import type { ProfileFacetsInput } from "#/server/profile/profile-schemas";
import * as schema from "../../../../drizzle/schema";

export async function submitProfileFacetsAction(
  data: ProfileFacetsInput,
): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not authorized to submit a profile");
  }

  const db = getDb();
  const userId = principal.userId;
  const now = Temporal.Now.instant();

  const stmts: Parameters<typeof db.batch>[0][number][] = [
    db
      .delete(schema.profilePrompts)
      .where(eq(schema.profilePrompts.userId, userId)),
    db
      .delete(schema.profileDisciplines)
      .where(eq(schema.profileDisciplines.userId, userId)),
  ];

  if (data.prompts.length > 0) {
    stmts.push(
      db.insert(schema.profilePrompts).values(
        data.prompts.map((prompt, i) => ({
          userId,
          promptKey: prompt.key,
          answer: prompt.answer,
          // Index in the submitted array IS the member's ordering —
          // the form lets them reorder, and nothing else reads this
          // column except the profile's `ORDER BY`.
          position: i,
          updatedAt: now,
        })),
      ),
    );
  }

  if (data.disciplines.length > 0) {
    stmts.push(
      db.insert(schema.profileDisciplines).values(
        data.disciplines.map((rating) => ({
          userId,
          discipline: rating.discipline,
          level: rating.level,
          updatedAt: now,
        })),
      ),
    );
  }

  // `db.batch` needs a non-empty tuple; the two deletes always make
  // it so, which is why they are unconditional rather than skipped
  // when the member is clearing everything.
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}

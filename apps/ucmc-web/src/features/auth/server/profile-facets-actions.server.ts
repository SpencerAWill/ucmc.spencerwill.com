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
import { getDb, insertStatements, runBatch } from "#/server/db";
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

  // Split to fit like every multi-row write (#291). Small today — three
  // prompts, seven disciplines — but bounded only by the registries,
  // which grow without anyone looking at this file.
  stmts.push(
    ...insertStatements(
      schema.profilePrompts,
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
    ...insertStatements(
      schema.profileDisciplines,
      data.disciplines.map((rating) => ({
        userId,
        discipline: rating.discipline,
        level: rating.level,
        updatedAt: now,
      })),
    ),
  );

  await runBatch(stmts);

  return { ok: true };
}

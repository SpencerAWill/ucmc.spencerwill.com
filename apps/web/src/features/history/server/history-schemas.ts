/**
 * Zod schemas for /history mutation inputs. Shared by the server-fn
 * `inputValidator` (server side) and the route-facing TypeScript types
 * consumed by mutation hooks (client side). Keeping them in one file
 * means the wire shape and the form shape can never drift.
 */
import { z } from "zod";

// ── narrative ───────────────────────────────────────────────────────────

// Generous cap; the seeded narrative is ~3 KB and a reasonable history
// page won't exceed a few thousand words. 50 KB matches the wiggle
// room the announcements editor uses.
export const NARRATIVE_MAX = 50_000;

export const updateNarrativeInputSchema = z.object({
  markdown: z.string().max(NARRATIVE_MAX),
});
export type UpdateNarrativeInput = z.infer<typeof updateNarrativeInputSchema>;

// ── historical officers ─────────────────────────────────────────────────

const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;

const officerFields = {
  // e.g. "2026-27". Format is enforced so the dropdown in PastOfficers
  // groups cleanly; archive_officers cron uses the same shape.
  schoolYear: z
    .string()
    .regex(SCHOOL_YEAR_RE, "Expected YYYY-YY (e.g. 2026-27)"),
  // Drives sort order across years. Must agree with schoolYear's
  // leading 4 digits (caller enforces this in the form).
  startYear: z.number().int().min(1900).max(2100),
  // Free-form so the historical record can preserve "Librarian" etc.
  role: z.string().trim().min(1).max(80),
  // 1=President, 2=VP, 3=Treasurer, 4=Secretary, 5=Trip Coordinator,
  // 6=Equipment Manager, 7=Gear Assistants, 8=Librarian, … Free-form
  // integer so future roles slot in without a schema migration.
  roleOrder: z.number().int().min(0).max(99),
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).nullable().default(null),
} as const;

export const createHistoricalOfficerInputSchema = z.object(officerFields);
export type CreateHistoricalOfficerInput = z.infer<
  typeof createHistoricalOfficerInputSchema
>;

export const updateHistoricalOfficerInputSchema = z.object({
  id: z.number().int().positive(),
  ...officerFields,
});
export type UpdateHistoricalOfficerInput = z.infer<
  typeof updateHistoricalOfficerInputSchema
>;

export const deleteByIdInputSchema = z.object({
  id: z.number().int().positive(),
});
export type DeleteByIdInput = z.infer<typeof deleteByIdInputSchema>;

// ── honorary members ────────────────────────────────────────────────────

const honoraryFields = {
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(9999),
  notes: z.string().trim().max(500).nullable().default(null),
} as const;

export const createHonoraryMemberInputSchema = z.object(honoraryFields);
export type CreateHonoraryMemberInput = z.infer<
  typeof createHonoraryMemberInputSchema
>;

export const updateHonoraryMemberInputSchema = z.object({
  id: z.number().int().positive(),
  ...honoraryFields,
});
export type UpdateHonoraryMemberInput = z.infer<
  typeof updateHonoraryMemberInputSchema
>;

/**
 * Zod schemas for /history mutation inputs. Shared by the server-fn
 * `validator` (server side) and the route-facing TypeScript types
 * consumed by mutation hooks (client side). Keeping them in one file
 * means the wire shape and the form shape can never drift.
 */
import { z } from "zod";

// Narrative editing moved to the generic markdown_pages action layer
// (see #/server/markdown-pages/markdown-pages-schemas.ts) — the
// /history page passes slug="history.narrative" through that path.

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

/**
 * Bulk-delete every historical-officer row for one school year.
 * Identified by `startYear` (an integer like 2022) rather than the
 * `school_year` string so the server doesn't need to re-parse the
 * "YYYY-YY" format. The /history Manage UI passes both alongside;
 * `startYear` is the source of truth on the wire.
 */
export const deleteOfficersByYearInputSchema = z.object({
  startYear: z.number().int().min(1900).max(2100),
});
export type DeleteOfficersByYearInput = z.infer<
  typeof deleteOfficersByYearInputSchema
>;

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

/**
 * Bulk-reorder honorary members. `ids` is the new display order
 * (lowest sort_order first); the server rewrites every row's
 * sort_order to its index + 1 to match. Capped at 500 entries —
 * the legacy seed has 36, this leaves plenty of headroom.
 */
export const reorderHonoraryMembersInputSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500),
});
export type ReorderHonoraryMembersInput = z.infer<
  typeof reorderHonoraryMembersInputSchema
>;

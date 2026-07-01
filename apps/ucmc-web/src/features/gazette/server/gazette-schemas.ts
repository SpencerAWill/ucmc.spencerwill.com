/**
 * Zod schemas for /gazette mutation inputs. Shared by the server-fn
 * `inputValidator` (server side) and the typed mutation hooks
 * (client side). The PDF payload is a base64 dataUrl; size validation
 * lives here as a first defense against oversized uploads, with R2
 * + worker enforcement as defense-in-depth.
 */
import { z } from "zod";

/**
 * 10 MB cap matches the storage layer's `GAZETTE_MAX_BYTES`. The
 * base64-encoded payload is ~33 % larger than the decoded bytes;
 * Zod's `.max()` constraint is on the string length, so we relax
 * accordingly. Actions decode then re-check the decoded length
 * against the storage cap as the authoritative test.
 */
export const GAZETTE_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const GAZETTE_PDF_DATA_URL_MAX = Math.ceil(
  (GAZETTE_PDF_MAX_BYTES * 4) / 3 + 100, // base64 overhead + dataUrl prefix
);

const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;
const PDF_DATA_URL_RE = /^data:application\/pdf;base64,([A-Za-z0-9+/]+=*)$/;

const issueFields = {
  schoolYear: z
    .string()
    .regex(SCHOOL_YEAR_RE, "Expected YYYY-YY (e.g. 2026-27)"),
  startYear: z.number().int().min(1900).max(2100),
  issueNumber: z.number().int().min(1).max(99),
  title: z.string().trim().max(200).nullable().default(null),
  editor: z.string().trim().max(200).nullable().default(null),
  publishedAt: z.coerce.date().nullable().default(null),
  description: z.string().trim().max(500).nullable().default(null),
} as const;

const pdfDataUrl = z
  .string()
  .max(GAZETTE_PDF_DATA_URL_MAX, {
    message: `PDF exceeds the ${GAZETTE_PDF_MAX_BYTES / (1024 * 1024)} MB cap`,
  })
  .regex(PDF_DATA_URL_RE, {
    message: "Expected a base64 data URL with application/pdf MIME type",
  });

export const createGazetteIssueInputSchema = z.object({
  ...issueFields,
  pdfDataUrl,
});
export type CreateGazetteIssueInput = z.infer<
  typeof createGazetteIssueInputSchema
>;

/**
 * Update accepts an optional `pdfDataUrl`: omit to keep the existing
 * PDF (metadata-only edit), include to swap the file. Action layer
 * deletes the previous R2 object best-effort after a successful swap.
 */
export const updateGazetteIssueInputSchema = z.object({
  publicId: z.string().min(1),
  ...issueFields,
  pdfDataUrl: pdfDataUrl.optional(),
});
export type UpdateGazetteIssueInput = z.infer<
  typeof updateGazetteIssueInputSchema
>;

export const deleteGazetteIssueInputSchema = z.object({
  publicId: z.string().min(1),
});
export type DeleteGazetteIssueInput = z.infer<
  typeof deleteGazetteIssueInputSchema
>;

export const getGazetteIssueByPublicIdInputSchema = z.object({
  publicId: z.string().min(1),
});
export type GetGazetteIssueByPublicIdInput = z.infer<
  typeof getGazetteIssueByPublicIdInputSchema
>;

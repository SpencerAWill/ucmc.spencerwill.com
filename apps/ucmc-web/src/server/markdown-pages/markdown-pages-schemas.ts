/**
 * Wire schemas for /markdown-pages server fns. Shared by the
 * `inputValidator` on the server side and the typed mutation hooks
 * on the client. The slug enum mirrors the constant in
 * `slugs.ts` so a typo can't write to an unknown page.
 */
import { z } from "zod";

import { MARKDOWN_PAGE_SLUGS } from "#/server/markdown-pages/slugs";

const slugEnum = z.enum(MARKDOWN_PAGE_SLUGS);

/** Same cap as the legacy /history narrative editor. */
export const MARKDOWN_PAGE_MAX = 50_000;

export const getMarkdownPageInputSchema = z.object({
  slug: slugEnum,
});
export type GetMarkdownPageInput = z.infer<typeof getMarkdownPageInputSchema>;

export const updateMarkdownPageInputSchema = z.object({
  slug: slugEnum,
  markdown: z.string().max(MARKDOWN_PAGE_MAX),
});
export type UpdateMarkdownPageInput = z.infer<
  typeof updateMarkdownPageInputSchema
>;

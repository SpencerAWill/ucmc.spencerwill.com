/**
 * Route-facing shells for /markdown-pages server fns. Each handler
 * body dynamic-imports the action module so server-only code never
 * reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import {
  getMarkdownPageInputSchema,
  updateMarkdownPageInputSchema,
} from "#/server/markdown-pages/markdown-pages-schemas";
import type { MarkdownPageSlug } from "#/server/markdown-pages/slugs";

export const getMarkdownPageFn = createServerFn({ method: "GET" })
  .inputValidator(getMarkdownPageInputSchema)
  .handler(
    async ({ data }): Promise<{ slug: MarkdownPageSlug; markdown: string }> => {
      const { getMarkdownPageAction } =
        await import("#/server/markdown-pages/markdown-pages-actions.server");
      return getMarkdownPageAction(data);
    },
  );

export const updateMarkdownPageFn = createServerFn({ method: "POST" })
  .inputValidator(updateMarkdownPageInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateMarkdownPageAction } =
      await import("#/server/markdown-pages/markdown-pages-actions.server");
    return updateMarkdownPageAction(data);
  });

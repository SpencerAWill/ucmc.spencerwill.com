import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateMarkdownPageFn } from "#/server/markdown-pages/markdown-pages-fns";
import type { UpdateMarkdownPageInput } from "#/server/markdown-pages/markdown-pages-schemas";
import { markdownPageQueryKey } from "#/server/markdown-pages/queries";

/**
 * Update one markdown page's body. Invalidates only the affected
 * page's cache entry; sibling pages are untouched.
 */
export function useUpdateMarkdownPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateMarkdownPageInput) =>
      updateMarkdownPageFn({ data }),
    onSuccess: (_res, vars) =>
      queryClient.invalidateQueries({
        queryKey: markdownPageQueryKey(vars.slug),
      }),
  });
}

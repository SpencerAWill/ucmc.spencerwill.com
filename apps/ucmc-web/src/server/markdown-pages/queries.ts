/**
 * TanStack Query options for `markdown_pages`. Per-slug cache key so
 * pages don't share invalidation — editing /policies doesn't bust the
 * /scholarships cache.
 */
import { getMarkdownPageFn } from "#/server/markdown-pages/markdown-pages-fns";
import type { MarkdownPageSlug } from "#/server/markdown-pages/slugs";

export function markdownPageQueryKey(slug: MarkdownPageSlug) {
  return ["markdown-page", slug] as const;
}

export function markdownPageQueryOptions(slug: MarkdownPageSlug) {
  return {
    queryKey: markdownPageQueryKey(slug),
    queryFn: () => getMarkdownPageFn({ data: { slug } }),
    // 5 minutes — these pages change rarely and route loaders prefetch.
    staleTime: 5 * 60_000,
  } as const;
}

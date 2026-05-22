import { GALLERY_LIST_QUERY_KEY } from "#/features/gallery/api/query-keys";
import { getGalleryPhotosFn } from "#/features/gallery/server/gallery-fns";

/**
 * Bundled photo list for the /gallery page. Photos change at most a
 * few times per season, so a long staleTime keeps the page snappy
 * across navigations.
 */
export function galleryListQueryOptions() {
  return {
    queryKey: GALLERY_LIST_QUERY_KEY,
    queryFn: () => getGalleryPhotosFn(),
    staleTime: 5 * 60_000,
  } as const;
}

import { ALBUM_LIST_QUERY_KEY } from "#/features/album/api/query-keys";
import { getAlbumPhotosFn } from "#/features/album/server/album-fns";

/**
 * Bundled photo list for the /album page. Photos change at most a
 * few times per season, so a long staleTime keeps the page snappy
 * across navigations.
 */
export function albumListQueryOptions() {
  return {
    queryKey: ALBUM_LIST_QUERY_KEY,
    queryFn: () => getAlbumPhotosFn(),
    staleTime: 5 * 60_000,
  } as const;
}

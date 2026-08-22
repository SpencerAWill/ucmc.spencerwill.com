import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ALBUM_LIST_QUERY_KEY } from "#/features/album/api/query-keys";
import {
  createAlbumPhotoFn,
  deleteAlbumPhotoFn,
  updateAlbumPhotoFn,
} from "#/features/album/server/album-fns";
import type {
  CreateAlbumPhotoInput,
  DeleteAlbumPhotoInput,
  UpdateAlbumPhotoInput,
} from "#/features/album/server/album-schemas";

/**
 * Create / update / delete hooks for Album photos. Each
 * mutation invalidates the bundled list cache.
 */
export function useCreateAlbumPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAlbumPhotoInput) => createAlbumPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ALBUM_LIST_QUERY_KEY }),
  });
}

export function useUpdateAlbumPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAlbumPhotoInput) => updateAlbumPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ALBUM_LIST_QUERY_KEY }),
  });
}

export function useDeleteAlbumPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteAlbumPhotoInput) => deleteAlbumPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ALBUM_LIST_QUERY_KEY }),
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { GALLERY_LIST_QUERY_KEY } from "#/features/gallery/api/query-keys";
import {
  createGalleryPhotoFn,
  deleteGalleryPhotoFn,
  updateGalleryPhotoFn,
} from "#/features/gallery/server/gallery-fns";
import type {
  CreateGalleryPhotoInput,
  DeleteGalleryPhotoInput,
  UpdateGalleryPhotoInput,
} from "#/features/gallery/server/gallery-schemas";

/**
 * Create / update / delete hooks for Trip Gallery photos. Each
 * mutation invalidates the bundled list cache.
 */
export function useCreateGalleryPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGalleryPhotoInput) =>
      createGalleryPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: GALLERY_LIST_QUERY_KEY }),
  });
}

export function useUpdateGalleryPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateGalleryPhotoInput) =>
      updateGalleryPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: GALLERY_LIST_QUERY_KEY }),
  });
}

export function useDeleteGalleryPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteGalleryPhotoInput) =>
      deleteGalleryPhotoFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: GALLERY_LIST_QUERY_KEY }),
  });
}

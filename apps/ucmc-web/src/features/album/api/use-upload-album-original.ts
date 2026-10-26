import { useMutation } from "@tanstack/react-query";

import { uploadAlbumOriginalFn } from "#/features/album/server/album-fns";
import type { UploadAlbumOriginalResult } from "#/features/album/server/album-fns";

function toFormData(input: { file: File; photoId?: string }): FormData {
  const form = new FormData();
  form.append("file", input.file);
  if (input.photoId !== undefined) {
    form.append("photoId", input.photoId);
  }
  return form;
}

/**
 * Uploads the member's original file before the crop is saved.
 *
 * Deliberately invalidates nothing: no album_photos row exists yet, so
 * there is no cached list this could change. The row is written later by
 * create/update, which do invalidate.
 */
export function useUploadAlbumOriginal() {
  return useMutation<
    UploadAlbumOriginalResult,
    Error,
    { file: File; photoId?: string }
  >({
    mutationFn: (input) => uploadAlbumOriginalFn({ data: toFormData(input) }),
  });
}

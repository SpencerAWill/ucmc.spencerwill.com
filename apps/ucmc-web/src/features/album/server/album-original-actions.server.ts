/**
 * Uploads an Album photo's raw original ahead of the crop being saved.
 *
 * The raw bytes go to the private bucket and are never served. A clean
 * (metadata-free) WebP copy is rendered once through the Images binding
 * and stored beside it. If rendering fails the upload still succeeds with
 * `fullKey: null` and self-repair fills the copy in later. See "Upload
 * flow" in docs/superpowers/2026-10-25-album-originals/design.md.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { renderCleanWebp } from "#/features/album/server/album-clean-copy.server";
import { requireAlbumManager } from "#/features/album/server/album-permissions.server";
import {
  UPLOAD_NO_FILE,
  UPLOAD_NOT_AN_IMAGE,
  UPLOAD_PHOTO_GONE,
  UPLOAD_RATE_LIMITED,
  UPLOAD_STORE_FAILED,
  uploadTooLargeMessage,
} from "#/features/album/lib/upload-messages";
import { MAX_SOURCE_BYTES } from "#/lib/image-upload";
import { getDb, schema } from "#/server/db";
import { errorMessage, log } from "#/server/log/log.server";
import {
  albumFullKey,
  albumOriginalKey,
  putAlbumFull,
  putAlbumOriginal,
} from "#/server/r2/album-originals.server";
import { readExifCaptureDate } from "#/server/r2/exif-date.server";
import {
  matchesImageMagic,
  shortContentHash,
} from "#/server/r2/image-codec.server";
import type { AcceptedImageContentType } from "#/server/r2/image-codec.server";
import { checkUploadRateLimit } from "#/server/rate-limit.server";

export interface UploadAlbumOriginalResult {
  photoId: string;
  originalKey: string;
  fullKey: string | null;
  takenDate: string | null;
  originalBytes: number;
  fullWidthPx: number | null;
  fullHeightPx: number | null;
}

const ACCEPTED: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

function isAccepted(type: string): type is AcceptedImageContentType {
  return ACCEPTED.includes(type);
}

/**
 * Runs a storage step, logging a raw failure and rethrowing a fixed
 * message: D1 and R2 text must not reach the member.
 */
async function storing<T>(event: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    log.error(event, { error: errorMessage(err) });
    throw new Error(UPLOAD_STORE_FAILED, { cause: err });
  }
}

/** An edit reuses the existing row's id; a create mints a new one. */
async function resolvePhotoId(requested: FormDataEntryValue | null) {
  if (typeof requested !== "string" || requested === "") {
    return uuidv7();
  }
  const row = await storing("album.photo_lookup_failed", () =>
    getDb()
      .select({ id: schema.albumPhotos.id })
      .from(schema.albumPhotos)
      .where(eq(schema.albumPhotos.id, requested))
      .get(),
  );
  if (!row) {
    throw new Error(UPLOAD_PHOTO_GONE);
  }
  return row.id;
}

/** Never throws: a failed clean copy leaves `fullKey: null` for self-repair. */
async function storeCleanCopy(
  photoId: string,
  hash: string,
  original: ArrayBuffer,
): Promise<{
  fullKey: string | null;
  fullWidthPx: number | null;
  fullHeightPx: number | null;
}> {
  try {
    const clean = await renderCleanWebp(original);
    const fullKey = albumFullKey(photoId, hash);
    await putAlbumFull(fullKey, clean.bytes, clean);
    return {
      fullKey,
      fullWidthPx: clean.widthPx,
      fullHeightPx: clean.heightPx,
    };
  } catch (err) {
    log.error("album.clean_copy_failed", { photoId, error: errorMessage(err) });
    return { fullKey: null, fullWidthPx: null, fullHeightPx: null };
  }
}

export async function uploadAlbumOriginalAction(
  form: FormData,
): Promise<UploadAlbumOriginalResult> {
  const principal = await requireAlbumManager();
  if (!(await checkUploadRateLimit(principal.userId))) {
    throw new Error(UPLOAD_RATE_LIMITED);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new Error(UPLOAD_NO_FILE);
  }
  // The multipart body is already parsed by now, so this cap saves the second
  // copy and does not bound request memory.
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(uploadTooLargeMessage(file.size));
  }
  if (!isAccepted(file.type)) {
    throw new Error(UPLOAD_NOT_AN_IMAGE);
  }
  const bytes = await file.arrayBuffer();
  if (!matchesImageMagic(new Uint8Array(bytes), file.type)) {
    throw new Error(UPLOAD_NOT_AN_IMAGE);
  }

  const photoId = await resolvePhotoId(form.get("photoId"));
  const hash = await shortContentHash(bytes);
  const contentType = file.type;
  const originalKey = albumOriginalKey(photoId, hash, contentType);
  await storing("album.original_put_failed", () =>
    putAlbumOriginal(originalKey, bytes, contentType),
  );

  const { fullKey, fullWidthPx, fullHeightPx } = await storeCleanCopy(
    photoId,
    hash,
    bytes,
  );

  return {
    photoId,
    originalKey,
    fullKey,
    takenDate: readExifCaptureDate(new Uint8Array(bytes))?.toString() ?? null,
    originalBytes: bytes.byteLength,
    fullWidthPx,
    fullHeightPx,
  };
}

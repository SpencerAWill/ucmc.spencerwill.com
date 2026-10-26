/**
 * Uploads an Album photo's raw original ahead of the crop being saved.
 *
 * The raw bytes go to the private bucket and are never served. A clean
 * (metadata-free) WebP copy is rendered once through the Images binding
 * and stored beside it. If rendering fails the upload still succeeds with
 * `fullKey: null` and self-repair fills the copy in later. See "Upload
 * flow" in docs/superpowers/2026-10-25-album-originals/design.md.
 */
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { renderCleanWebp } from "#/features/album/server/album-clean-copy.server";
import { getAlbumPhotoByPublicId } from "#/features/album/server/album-repo.server";
import {
  canViewAlbumOriginal,
  requireAlbumManager,
} from "#/features/album/server/album-permissions.server";
import {
  UPLOAD_NO_FILE,
  UPLOAD_NOT_AN_IMAGE,
  UPLOAD_PHOTO_GONE,
  UPLOAD_RATE_LIMITED,
  UPLOAD_STORE_FAILED,
  uploadTooLargeMessage,
} from "#/features/album/lib/upload-messages";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { MAX_SOURCE_BYTES } from "#/lib/image-upload";
import { getDb, schema } from "#/server/db";
import { errorMessage, log } from "#/server/log/log.server";
import {
  albumFullKey,
  albumOriginalKey,
  getAlbumPrivate,
  parseAlbumOriginalKey,
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

const FULL_FILE_RE = /^[0-9a-f]{16}\.webp$/;

/**
 * Builds the missing clean copy from the stored original and records it.
 * The UPDATE is guarded on `full_key IS NULL`, so of two racing viewers
 * only the first changes the row. The loser wrote the same bytes to the
 * same key (the key is derived from the original's hash), so it serves
 * its own copy and nothing is clobbered. Returns the key, or `null` when
 * the original is gone or cannot be rendered.
 */
async function repairFullCopy(
  photoId: string,
  originalKey: string,
  hash: string,
): Promise<string | null> {
  try {
    const original = await getAlbumPrivate(originalKey);
    if (!original) {
      log.warn("album.full_repair_original_missing", { photoId, originalKey });
      return null;
    }
    const clean = await renderCleanWebp(await original.arrayBuffer());
    const fullKey = albumFullKey(photoId, hash);
    await putAlbumFull(fullKey, clean.bytes, clean);
    const db = getDb();
    const updated = await db
      .update(schema.albumPhotos)
      .set({
        fullKey,
        fullWidthPx: clean.widthPx,
        fullHeightPx: clean.heightPx,
        fullBytes: clean.bytes.byteLength,
      })
      .where(
        and(
          eq(schema.albumPhotos.id, photoId),
          eq(schema.albumPhotos.originalKey, originalKey),
          isNull(schema.albumPhotos.fullKey),
        ),
      )
      .returning({ id: schema.albumPhotos.id });
    if (updated.length > 0) {
      return fullKey;
    }
    // Lost the race, or the image was replaced while rendering. The copy
    // is only good to serve while it still matches the current original.
    const current = await db
      .select({ originalKey: schema.albumPhotos.originalKey })
      .from(schema.albumPhotos)
      .where(eq(schema.albumPhotos.id, photoId))
      .get();
    return current?.originalKey === originalKey ? fullKey : null;
  } catch (err) {
    log.error("album.full_repair_failed", {
      photoId,
      error: errorMessage(err),
    });
    return null;
  }
}

/**
 * The full-size clean copy for members. `null` is every refusal alike
 * (signed out, no permission, unknown or legacy photo, stale `file`,
 * failed self-repair, missing object): the route turns them into one
 * identical 404.
 */
export async function getAlbumFullImageAction(
  publicId: string,
  file: string,
): Promise<{ body: ReadableStream; bytes: number; publicId: string } | null> {
  if (!FULL_FILE_RE.test(file)) {
    return null;
  }
  const principal = await loadCurrentPrincipal();
  if (!principal || !canViewAlbumOriginal(principal)) {
    return null;
  }
  const row = await getAlbumPhotoByPublicId(publicId);
  if (!row?.originalKey) {
    return null;
  }
  const hash = parseAlbumOriginalKey(row.originalKey)?.hash;
  if (!hash || file !== `${hash}.webp`) {
    return null;
  }
  // Only a key derived from the current original's hash is trusted; any
  // other value is stale and treated as missing.
  const fullKey =
    row.fullKey === albumFullKey(row.id, hash)
      ? row.fullKey
      : await repairFullCopy(row.id, row.originalKey, hash);
  if (!fullKey) {
    return null;
  }
  const object = await getAlbumPrivate(fullKey);
  return object
    ? { body: object.body, bytes: object.size, publicId: row.publicId }
    : null;
}

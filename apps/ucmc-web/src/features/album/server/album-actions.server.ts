/**
 * Album CRUD actions. Reads (`getAlbumPhotosAction`,
 * `getAlbumPhotoByPublicIdAction`) are gated at the route layer by
 * `public_album:view`; writes gate on `public_album:manage` here
 * via `requireAlbumManager()` and record one audit event per
 * mutation.
 *
 * Image flow:
 *   1. Client crops the source picture to a 4:3 canvas at 1600×1200
 *      via `useImageCrop()`, emits a base64 WebP data URL.
 *   2. Action decodes the base64, verifies the RIFF/WEBP magic
 *      bytes, checks the size cap, computes a content-hash, uploads
 *      to `BUCKET_PUBLIC` under `gallery/<id>/<hash>.webp` (the
 *      prefix is historical — see `albumImageKey()`).
 *   3. D1 row stores the key + file size + width/height. The CDN
 *      serves the bytes directly on subsequent reads.
 *
 * Replacement on update: when `imageDataUrl` is supplied, the new
 * file is uploaded under a new key and the old key is best-effort
 * deleted. If the delete fails (eventual consistency, R2 hiccup),
 * the orphan-GC sweep in `retention.server.ts` picks it up on the
 * next daily run.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { requireAlbumManager } from "#/features/album/server/album-permissions.server";
import {
  getAlbumPhotoByPublicId,
  listAlbumPhotos,
} from "#/features/album/server/album-repo.server";
import type {
  CreateAlbumPhotoInput,
  DeleteAlbumPhotoInput,
  GetAlbumPhotoByPublicIdInput,
  UpdateAlbumPhotoInput,
} from "#/features/album/server/album-schemas";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";
import {
  deleteAlbumImage,
  albumImageKey,
  ALBUM_IMAGE_MAX_BYTES,
  putAlbumImage,
} from "#/server/r2/album-images.server";
import { shortContentHash } from "#/server/r2/image-codec.server";

// ── public shapes ───────────────────────────────────────────────────────

export interface AlbumPhotoSummary {
  id: string;
  publicId: string;
  caption: string | null;
  credit: string | null;
  takenAt: Temporal.Instant | null;
  tag: string | null;
  altText: string;
  imageKey: string;
  imageBytes: number;
  widthPx: number;
  heightPx: number;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function getAlbumPhotosAction(): Promise<{
  photos: AlbumPhotoSummary[];
}> {
  const rows = await listAlbumPhotos();
  return {
    photos: rows.map((r) => ({
      id: r.id,
      publicId: r.publicId,
      caption: r.caption,
      credit: r.credit,
      takenAt: r.takenAt,
      tag: r.tag,
      altText: r.altText,
      imageKey: r.imageKey,
      imageBytes: r.imageBytes,
      widthPx: r.widthPx,
      heightPx: r.heightPx,
    })),
  };
}

export async function getAlbumPhotoByPublicIdAction(
  input: GetAlbumPhotoByPublicIdInput,
): Promise<AlbumPhotoSummary | null> {
  const row = await getAlbumPhotoByPublicId(input.publicId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    publicId: row.publicId,
    caption: row.caption,
    credit: row.credit,
    takenAt: row.takenAt,
    tag: row.tag,
    altText: row.altText,
    imageKey: row.imageKey,
    imageBytes: row.imageBytes,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
  };
}

// ── mutations (public_album:manage) ──────────────────────────────────

const WEBP_DATA_URL_RE = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/;
// "RIFF" + 4-byte size (unchecked) + "WEBP"
const WEBP_MAGIC_HEAD = [0x52, 0x49, 0x46, 0x46]; // RIFF
const WEBP_MAGIC_TAIL = [0x57, 0x45, 0x42, 0x50]; // WEBP

function decodeWebpDataUrl(dataUrl: string): ArrayBuffer {
  const match = WEBP_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("Image data URL is not the expected image/webp shape");
  }
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > ALBUM_IMAGE_MAX_BYTES) {
    throw new Error(
      `Image exceeds ${ALBUM_IMAGE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  // Magic-byte check: an attacker who skips the client could lie
  // in the dataUrl prefix. The WebP container starts with "RIFF"
  // at byte 0, a 4-byte size, then "WEBP" at byte 8.
  if (
    bytes.length < 12 ||
    bytes[0] !== WEBP_MAGIC_HEAD[0] ||
    bytes[1] !== WEBP_MAGIC_HEAD[1] ||
    bytes[2] !== WEBP_MAGIC_HEAD[2] ||
    bytes[3] !== WEBP_MAGIC_HEAD[3] ||
    bytes[8] !== WEBP_MAGIC_TAIL[0] ||
    bytes[9] !== WEBP_MAGIC_TAIL[1] ||
    bytes[10] !== WEBP_MAGIC_TAIL[2] ||
    bytes[11] !== WEBP_MAGIC_TAIL[3]
  ) {
    throw new Error("Image bytes do not have the RIFF/WEBP magic header");
  }
  return bytes.buffer;
}

export async function createAlbumPhotoAction(
  input: CreateAlbumPhotoInput,
): Promise<{ publicId: string }> {
  const principal = await requireAlbumManager();

  const bytes = decodeWebpDataUrl(input.imageDataUrl);
  const id = uuidv7();
  const publicId = generatePublicId();
  const hash = await shortContentHash(bytes);
  const imageKey = albumImageKey(id, hash);

  await putAlbumImage(imageKey, bytes);

  try {
    await getDb()
      .insert(schema.albumPhotos)
      .values({
        id,
        publicId,
        caption: input.caption,
        credit: input.credit,
        takenAt:
          input.takenAt === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(input.takenAt.getTime()),
        tag: input.tag,
        altText: input.altText,
        imageKey,
        imageBytes: bytes.byteLength,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      });
  } catch (err) {
    // Insert failed — clean up the orphan image so we don't leak
    // storage. Best-effort; the orphan-GC sweep catches anything we
    // miss.
    void deleteAlbumImage(imageKey).catch(() => {});
    throw err;
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "album_photo.created",
    targetType: "album_photo",
    targetId: id,
    metadata: {
      caption: input.caption,
      tag: input.tag,
    },
  });

  return { publicId };
}

export async function updateAlbumPhotoAction(
  input: UpdateAlbumPhotoInput,
): Promise<{ ok: true }> {
  const principal = await requireAlbumManager();

  const existing = await getAlbumPhotoByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Album photo not found");
  }

  let imageKey = existing.imageKey;
  let imageBytes = existing.imageBytes;
  let oldKeyToDelete: string | null = null;

  if (input.imageDataUrl) {
    const bytes = decodeWebpDataUrl(input.imageDataUrl);
    const hash = await shortContentHash(bytes);
    const newKey = albumImageKey(existing.id, hash);
    // Only swap if the content actually changed (hash differs).
    if (newKey !== existing.imageKey) {
      await putAlbumImage(newKey, bytes);
      oldKeyToDelete = existing.imageKey;
      imageKey = newKey;
      imageBytes = bytes.byteLength;
    }
  }

  try {
    await getDb()
      .update(schema.albumPhotos)
      .set({
        caption: input.caption,
        credit: input.credit,
        takenAt:
          input.takenAt === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(input.takenAt.getTime()),
        tag: input.tag,
        altText: input.altText,
        imageKey,
        imageBytes,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        updatedAt: Temporal.Now.instant(),
        updatedBy: principal.userId,
      })
      .where(eq(schema.albumPhotos.id, existing.id));
  } catch (err) {
    // UPDATE failed. If we already PUT a replacement image, that
    // fresh key is now orphaned — clean it up to mirror the
    // symmetric handling on insert. The old image is still
    // referenced by the row, so leave it alone.
    if (imageKey !== existing.imageKey) {
      void deleteAlbumImage(imageKey).catch(() => {});
    }
    throw err;
  }

  if (oldKeyToDelete) {
    void deleteAlbumImage(oldKeyToDelete).catch(() => {});
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "album_photo.updated",
    targetType: "album_photo",
    targetId: existing.id,
    metadata: {
      caption: input.caption,
      tag: input.tag,
    },
  });

  return { ok: true };
}

export async function deleteAlbumPhotoAction(
  input: DeleteAlbumPhotoInput,
): Promise<{ ok: true }> {
  const principal = await requireAlbumManager();

  const existing = await getAlbumPhotoByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Album photo not found");
  }

  await getDb()
    .delete(schema.albumPhotos)
    .where(eq(schema.albumPhotos.id, existing.id));

  void deleteAlbumImage(existing.imageKey).catch(() => {});

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "album_photo.deleted",
    targetType: "album_photo",
    targetId: existing.id,
    metadata: {
      caption: existing.caption,
      tag: existing.tag,
    },
  });

  return { ok: true };
}

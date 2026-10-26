import { getPrivateBucket } from "#/server/r2";
import type { AcceptedImageContentType } from "#/server/r2/image-codec.server";

/**
 * Private-bucket layout for Album originals. Neither prefix is served
 * by a public URL, and no route re-prepends them: the full-size route
 * reads `album_photos.full_key` from the row after checking the viewer.
 *
 * Agreed by this module and the orphan sweep in
 * `server/cron/retention.server.ts`.
 *
 *   album-originals/<photoId>/<hash>.<jpg|png|webp>  raw bytes, never served
 *   album-full/<photoId>/<hash>.webp                 clean (EXIF-free) copy
 *
 * `<hash>` is `shortContentHash` of the raw original in both keys.
 */
export const ALBUM_ORIGINAL_PREFIX = "album-originals/";
export const ALBUM_FULL_PREFIX = "album-full/";

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<AcceptedImageContentType, string>;

const TYPE_BY_EXT: Record<string, AcceptedImageContentType> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORIGINAL_RE = new RegExp(
  `^${ALBUM_ORIGINAL_PREFIX}(${UUID})/([0-9a-f]{16})\\.(jpg|png|webp)$`,
);
const FULL_RE = new RegExp(
  `^${ALBUM_FULL_PREFIX}(${UUID})/([0-9a-f]{16})\\.webp$`,
);

export function albumOriginalKey(
  photoId: string,
  hash: string,
  contentType: AcceptedImageContentType,
): string {
  return `${ALBUM_ORIGINAL_PREFIX}${photoId}/${hash}.${EXT_BY_TYPE[contentType]}`;
}

export function albumFullKey(photoId: string, originalHash: string): string {
  return `${ALBUM_FULL_PREFIX}${photoId}/${originalHash}.webp`;
}

export function parseAlbumOriginalKey(key: string): {
  photoId: string;
  hash: string;
  contentType: AcceptedImageContentType;
} | null {
  const match = ORIGINAL_RE.exec(key);
  if (!match) {
    return null;
  }
  const contentType = TYPE_BY_EXT[match[3]];
  return { photoId: match[1], hash: match[2], contentType };
}

export function parseAlbumFullKey(
  key: string,
): { photoId: string; hash: string } | null {
  const match = FULL_RE.exec(key);
  return match ? { photoId: match[1], hash: match[2] } : null;
}

export async function putAlbumOriginal(
  key: string,
  bytes: ArrayBuffer,
  contentType: AcceptedImageContentType,
): Promise<void> {
  await getPrivateBucket().put(key, bytes, { httpMetadata: { contentType } });
}

export async function putAlbumFull(
  key: string,
  bytes: ArrayBuffer,
  dims: { widthPx: number; heightPx: number },
): Promise<void> {
  await getPrivateBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: {
      widthPx: String(dims.widthPx),
      heightPx: String(dims.heightPx),
    },
  });
}

export async function headAlbumPrivate(key: string): Promise<R2Object | null> {
  return getPrivateBucket().head(key);
}

export async function getAlbumPrivate(
  key: string,
): Promise<R2ObjectBody | null> {
  return getPrivateBucket().get(key);
}

/** Best-effort: the orphan sweep catches whatever this misses. */
export async function deleteAlbumPrivate(
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  try {
    await getPrivateBucket().delete([...keys]);
  } catch {
    // swallowed on purpose
  }
}

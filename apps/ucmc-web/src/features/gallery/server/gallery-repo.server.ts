/**
 * Pure data access for the Trip Gallery archive. No auth — actions
 * and routes enforce the `public_gallery:view` / `public_gallery:manage`
 * gates. Photos are returned sorted newest-first: rows with a
 * `taken_at` come first (most-recent date), then rows without a
 * taken-date fall back to created-at ordering (also DESC).
 */
import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export async function listGalleryPhotos() {
  const db = getDb();
  return (
    db
      .select({
        id: schema.galleryPhotos.id,
        publicId: schema.galleryPhotos.publicId,
        caption: schema.galleryPhotos.caption,
        credit: schema.galleryPhotos.credit,
        takenAt: schema.galleryPhotos.takenAt,
        tag: schema.galleryPhotos.tag,
        altText: schema.galleryPhotos.altText,
        imageKey: schema.galleryPhotos.imageKey,
        imageBytes: schema.galleryPhotos.imageBytes,
        widthPx: schema.galleryPhotos.widthPx,
        heightPx: schema.galleryPhotos.heightPx,
        createdAt: schema.galleryPhotos.createdAt,
      })
      .from(schema.galleryPhotos)
      // COALESCE(taken_at, created_at) keeps rows without a takenAt
      // sorted by their upload time so the grid never strands them at
      // the end with a NULL.
      .orderBy(
        desc(
          sql`COALESCE(${schema.galleryPhotos.takenAt}, ${schema.galleryPhotos.createdAt})`,
        ),
      )
  );
}

export async function getGalleryPhotoByPublicId(
  publicId: string,
): Promise<schema.GalleryPhoto | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.galleryPhotos)
    .where(eq(schema.galleryPhotos.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

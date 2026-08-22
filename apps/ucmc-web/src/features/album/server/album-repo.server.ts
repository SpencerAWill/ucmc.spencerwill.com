/**
 * Pure data access for the Album archive. No auth — actions
 * and routes enforce the `public_album:view` / `public_album:manage`
 * gates. Photos are returned sorted newest-first: rows with a
 * `taken_at` come first (most-recent date), then rows without a
 * taken-date fall back to created-at ordering (also DESC).
 */
import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export async function listAlbumPhotos() {
  const db = getDb();
  return (
    db
      .select({
        id: schema.albumPhotos.id,
        publicId: schema.albumPhotos.publicId,
        caption: schema.albumPhotos.caption,
        credit: schema.albumPhotos.credit,
        takenAt: schema.albumPhotos.takenAt,
        tag: schema.albumPhotos.tag,
        altText: schema.albumPhotos.altText,
        imageKey: schema.albumPhotos.imageKey,
        imageBytes: schema.albumPhotos.imageBytes,
        widthPx: schema.albumPhotos.widthPx,
        heightPx: schema.albumPhotos.heightPx,
        createdAt: schema.albumPhotos.createdAt,
      })
      .from(schema.albumPhotos)
      // COALESCE(taken_at, created_at) keeps rows without a takenAt
      // sorted by their upload time so the grid never strands them at
      // the end with a NULL.
      .orderBy(
        desc(
          sql`COALESCE(${schema.albumPhotos.takenAt}, ${schema.albumPhotos.createdAt})`,
        ),
      )
  );
}

export async function getAlbumPhotoByPublicId(
  publicId: string,
): Promise<schema.AlbumPhoto | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.albumPhotos)
    .where(eq(schema.albumPhotos.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

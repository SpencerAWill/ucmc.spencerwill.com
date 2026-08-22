import { Pencil, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { albumImageUrl } from "#/features/album/lib/image-url";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";

/**
 * One tile in the Album grid. Renders the cropped 4:3 WebP
 * with the photo's alt text. A semi-transparent overlay surfaces
 * the caption + tag on hover (or always on touch devices, where the
 * hover state isn't reliable).
 *
 * Clicking the tile opens the lightbox (parent handles).
 * `history:manage` holders see pencil + trash icons overlaid in the
 * top-right; the buttons stopPropagation so they don't trigger the
 * tile-click handler.
 */
export function PhotoCard({
  photo,
  onClick,
  canManage = false,
  onEdit,
  onDelete,
}: {
  photo: AlbumPhotoSummary;
  onClick: (photo: AlbumPhotoSummary) => void;
  canManage?: boolean;
  onEdit?: (photo: AlbumPhotoSummary) => void;
  onDelete?: (photo: AlbumPhotoSummary) => void;
}) {
  const imageUrl = albumImageUrl(photo.imageKey);
  return (
    <button
      type="button"
      onClick={() => onClick(photo)}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-md border border-border/60 bg-card/50 transition hover:border-border"
      aria-label={photo.caption ?? photo.altText}
    >
      <img
        src={imageUrl}
        alt={photo.altText}
        width={photo.widthPx}
        height={photo.heightPx}
        loading="lazy"
        className="size-full object-cover"
      />
      {photo.caption || photo.tag ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2 text-left text-xs text-white opacity-0 transition group-hover:opacity-100">
          {photo.caption ? (
            <p className="line-clamp-2 font-medium">{photo.caption}</p>
          ) : null}
          {photo.tag ? <p className="text-white/80">{photo.tag}</p> : null}
        </div>
      ) : null}
      {canManage ? (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {onEdit ? (
            <Button asChild variant="secondary" size="icon" className="size-7">
              <span
                role="button"
                tabIndex={0}
                aria-label={`Edit ${photo.caption ?? "photo"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(photo);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(photo);
                  }
                }}
              >
                <Pencil className="size-3.5" />
              </span>
            </Button>
          ) : null}
          {onDelete ? (
            <Button asChild variant="secondary" size="icon" className="size-7">
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${photo.caption ?? "photo"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(photo);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(photo);
                  }
                }}
              >
                <Trash2 className="size-3.5" />
              </span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { PhotoCard } from "#/features/album/components/photo-card";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";

const ALL_VALUE = "__all__";

/**
 * Album grid + filter surface. Server returns photos
 * newest-first; this component layers two client-side filters on
 * top: year (from `takenAt`) and tag.
 *
 * Filters live in component state, not URL search params, because
 * the lightbox already uses `?photo=$publicId` and we don't want to
 * juggle three search params for an MVP. If officers ask for
 * shareable filtered views, that's a small follow-up.
 *
 * Manage affordances (pencil / trash on each tile) are gated by the
 * caller passing `canManage`; the callbacks bubble up to the parent
 * route which owns the form-dialog and delete-confirm state.
 */
export function PhotoGrid({
  photos,
  canManage = false,
  onSelect,
  onEditPhoto,
  onDeletePhoto,
}: {
  photos: AlbumPhotoSummary[];
  canManage?: boolean;
  onSelect: (photo: AlbumPhotoSummary) => void;
  onEditPhoto?: (photo: AlbumPhotoSummary) => void;
  onDeletePhoto?: (photo: AlbumPhotoSummary) => void;
}) {
  // Distinct years from takenAt, in descending order.
  const years = Array.from(
    new Set(
      photos
        .map((p) =>
          p.takenAt ? p.takenAt.toZonedDateTimeISO("UTC").year : null,
        )
        .filter((y): y is number => y !== null),
    ),
  ).sort((a, b) => b - a);

  // Distinct tags from non-null entries, in alphabetical order.
  const tags = Array.from(
    new Set(photos.map((p) => p.tag).filter((t): t is string => Boolean(t))),
  ).sort((a, b) => a.localeCompare(b));

  const [selectedYear, setSelectedYear] = useState<string>(ALL_VALUE);
  const [selectedTag, setSelectedTag] = useState<string>(ALL_VALUE);

  if (photos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No photos on file yet.{" "}
        {canManage ? "Use Add photo to upload the first." : "Check back soon."}
      </p>
    );
  }

  const visible = photos.filter((p) => {
    if (selectedYear !== ALL_VALUE) {
      const year = p.takenAt ? p.takenAt.toZonedDateTimeISO("UTC").year : null;
      if (String(year) !== selectedYear) {
        return false;
      }
    }
    if (selectedTag !== ALL_VALUE && p.tag !== selectedTag) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="album-year"
            className="text-sm font-medium text-muted-foreground"
          >
            Year
          </label>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger id="album-year" className="w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All years</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="album-tag"
            className="text-sm font-medium text-muted-foreground"
          >
            Tag
          </label>
          <Select value={selectedTag} onValueChange={setSelectedTag}>
            <SelectTrigger id="album-tag" className="w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All tags</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No photos match the current filter.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {visible.map((photo) => (
            <PhotoCard
              key={photo.publicId}
              photo={photo}
              onClick={onSelect}
              canManage={canManage}
              onEdit={onEditPhoto}
              onDelete={onDeletePhoto}
            />
          ))}
        </div>
      )}
    </div>
  );
}

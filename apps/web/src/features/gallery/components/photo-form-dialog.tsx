import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
  useCreateGalleryPhoto,
  useUpdateGalleryPhoto,
} from "#/features/gallery/api/use-gallery-mutations";
import { galleryImageUrl } from "#/features/gallery/lib/image-url";
import type { GalleryPhotoSummary } from "#/features/gallery/server/gallery-fns";
import { useImageCrop } from "#/features/landing/lib/use-image-crop";
import { toDateInputValue } from "#/lib/date-format";

/**
 * Seed for opening the photo dialog. `mode = "create"` opens a fresh
 * form (an image upload + completed crop is required). `mode =
 * "edit"` pre-loads from an existing row — the file input is
 * optional (omit to keep the current image, attach to replace).
 */
export type PhotoFormSeed =
  | { mode: "create" }
  | { mode: "edit"; photo: GalleryPhotoSummary };

const GALLERY_OUTPUT_WIDTH = 1600;
const GALLERY_OUTPUT_HEIGHT = 1200;

interface FormState {
  caption: string;
  credit: string;
  takenAt: string; // YYYY-MM-DD for <input type="date">
  tag: string;
  altText: string;
}

function seedToForm(seed: PhotoFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      caption: seed.photo.caption ?? "",
      credit: seed.photo.credit ?? "",
      takenAt: seed.photo.takenAt ? toDateInputValue(seed.photo.takenAt) : "",
      tag: seed.photo.tag ?? "",
      altText: seed.photo.altText,
    };
  }
  return {
    caption: "",
    credit: "",
    takenAt: "",
    tag: "",
    altText: "",
  };
}

export function PhotoFormDialog({
  seed,
  onClose,
  knownTags = [],
}: {
  seed: PhotoFormSeed | null;
  onClose: () => void;
  knownTags?: string[];
}) {
  const createMut = useCreateGalleryPhoto();
  const updateMut = useUpdateGalleryPhoto();
  const [form, setForm] = useState<FormState | null>(null);

  const crop = useImageCrop({
    aspect: 4 / 3,
    outputWidth: GALLERY_OUTPUT_WIDTH,
    outputHeight: GALLERY_OUTPUT_HEIGHT,
  });

  // `useImageCrop()` returns a fresh object literal every render, so
  // we can't put `crop` in any dep array without triggering an infinite
  // loop. Stash `reset` in a ref so the seed effect can call it
  // without taking a dependency on `crop`.
  const cropResetRef = useRef(crop.reset);
  cropResetRef.current = crop.reset;

  // Re-seed the form whenever the dialog opens / the seed changes.
  // Also reset the crop UI on close so the previous photo's working
  // URL doesn't carry over.
  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
    if (seed === null) {
      cropResetRef.current();
    }
  }, [seed]);

  const submitting = createMut.isPending || updateMut.isPending;

  async function submit() {
    if (!form || !seed) {
      return;
    }
    const altText = form.altText.trim();
    if (altText.length === 0) {
      toast.error("Alt text is required for accessibility.");
      return;
    }

    // Only require a fresh crop on create. On edit, the existing
    // image stays if the user didn't load a new one.
    let imageDataUrl: string | null = null;
    if (crop.hasCompletedCrop) {
      imageDataUrl = await crop.getCroppedDataUrl();
      if (!imageDataUrl) {
        toast.error("Couldn't render the cropped image.");
        return;
      }
    } else if (seed.mode === "create") {
      toast.error("Pick a photo and complete the crop.");
      return;
    }

    const caption = form.caption.trim().length > 0 ? form.caption.trim() : null;
    const credit = form.credit.trim().length > 0 ? form.credit.trim() : null;
    const tag = form.tag.trim().length > 0 ? form.tag.trim() : null;
    const takenAt = form.takenAt.length > 0 ? new Date(form.takenAt) : null;

    const base = {
      caption,
      credit,
      takenAt,
      tag,
      altText,
      widthPx: GALLERY_OUTPUT_WIDTH,
      heightPx: GALLERY_OUTPUT_HEIGHT,
    };

    try {
      if (seed.mode === "create") {
        if (!imageDataUrl) {
          toast.error("Pick a photo and complete the crop.");
          return;
        }
        await createMut.mutateAsync({ ...base, imageDataUrl });
        toast.success("Photo uploaded.");
      } else {
        await updateMut.mutateAsync({
          publicId: seed.photo.publicId,
          ...base,
          ...(imageDataUrl ? { imageDataUrl } : {}),
        });
        toast.success("Photo updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the photo.",
      );
    }
  }

  const existingImageUrl =
    seed?.mode === "edit" ? galleryImageUrl(seed.photo.imageKey) : null;

  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit" ? "Edit photo" : "Add photo"}
          </DialogTitle>
          <DialogDescription>
            Photos are cropped to 4:3 at upload. Alt text is required for
            accessibility — describe what's in the photo for screen-reader
            users.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="gallery-photo-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submit();
            }}
          >
            <div className="space-y-2">
              <Label>Photo</Label>
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                {crop.workingUrl ? (
                  <ReactCrop {...crop.reactCropProps}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img {...crop.imgProps} />
                  </ReactCrop>
                ) : existingImageUrl ? (
                  <img
                    src={existingImageUrl}
                    alt={form.altText || "Current photo"}
                    className="max-h-[30dvh] max-w-full rounded-md sm:max-h-[40vh]"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Pick an image to begin cropping. Photos crop to a 4:3 aspect
                    at 1600×1200 WebP.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => crop.openPicker()}
                  >
                    <Upload className="size-4" />
                    {crop.workingUrl
                      ? "Pick different photo"
                      : existingImageUrl
                        ? "Replace photo"
                        : "Pick photo"}
                  </Button>
                  {crop.workingUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => crop.reset()}
                    >
                      Cancel new photo
                    </Button>
                  ) : null}
                </div>
                <input ref={crop.fileInputRef} {...crop.fileInputProps} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gallery-alt">Alt text (required)</Label>
                <Input
                  id="gallery-alt"
                  value={form.altText}
                  onChange={(e) =>
                    setForm({ ...form, altText: e.target.value })
                  }
                  placeholder="A short description of what's in the photo"
                  maxLength={300}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gallery-caption">Caption (optional)</Label>
                <Textarea
                  id="gallery-caption"
                  value={form.caption}
                  onChange={(e) =>
                    setForm({ ...form, caption: e.target.value })
                  }
                  rows={2}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gallery-credit">Credit (optional)</Label>
                <Input
                  id="gallery-credit"
                  value={form.credit}
                  onChange={(e) => setForm({ ...form, credit: e.target.value })}
                  placeholder="Photographer's name"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gallery-taken-at">Date taken (optional)</Label>
                <Input
                  id="gallery-taken-at"
                  type="date"
                  value={form.takenAt}
                  onChange={(e) =>
                    setForm({ ...form, takenAt: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gallery-tag">Tag (optional)</Label>
                <Input
                  id="gallery-tag"
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  placeholder="climbing, paddling, caving, etc."
                  list="gallery-tag-suggestions"
                  maxLength={50}
                />
                {knownTags.length > 0 ? (
                  <datalist id="gallery-tag-suggestions">
                    {knownTags.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                ) : null}
              </div>
            </div>
          </form>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="gallery-photo-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

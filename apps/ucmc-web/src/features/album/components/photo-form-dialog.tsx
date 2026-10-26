import { Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { ImagePickerError } from "#/components/image-picker-error";
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
import { useUploadAlbumOriginal } from "#/features/album/api/use-upload-album-original";
import {
  useCreateAlbumPhoto,
  useUpdateAlbumPhoto,
} from "#/features/album/api/use-album-mutations";
import { albumImageUrl } from "#/features/album/lib/image-url";
import { uploadErrorMessage } from "#/features/album/lib/upload-messages";
import { albumTakenDateToWire } from "#/features/album/lib/taken-date";
import type {
  AlbumPhotoSummary,
  UploadAlbumOriginalResult,
} from "#/features/album/server/album-fns";
import { useImageCrop } from "#/hooks/use-image-crop";
import { toDateInputValue } from "#/lib/date-format";

/**
 * Seed for opening the photo dialog. `mode = "create"` opens a fresh
 * form (an image upload + completed crop is required). `mode =
 * "edit"` pre-loads from an existing row — the file input is
 * optional (omit to keep the current image, attach to replace).
 */
export type PhotoFormSeed =
  { mode: "create" } | { mode: "edit"; photo: AlbumPhotoSummary };

const ALBUM_OUTPUT_WIDTH = 1600;
const ALBUM_OUTPUT_HEIGHT = 1200;

interface FormState {
  caption: string;
  credit: string;
  takenAt: string; // YYYY-MM-DD for <input type="date">
  tag: string;
  altText: string;
}

/**
 * Progress of the original-file upload for the *current* pick. Tracked
 * here rather than read off the mutation, because a superseded pick's
 * request is still in flight and must not be mistaken for this one's.
 */
interface UploadState {
  status: "idle" | "uploading" | "done" | "error";
  result: UploadAlbumOriginalResult | null;
  error: string | null;
}

const IDLE_UPLOAD: UploadState = { status: "idle", result: null, error: null };

function takenDateOrInvalid(value: string): Date | null | "invalid" {
  if (value.length === 0) {
    return null;
  }
  try {
    return albumTakenDateToWire(value);
  } catch {
    return "invalid";
  }
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
  const createMut = useCreateAlbumPhoto();
  const updateMut = useUpdateAlbumPhoto();
  const uploadMut = useUploadAlbumOriginal();
  const [form, setForm] = useState<FormState | null>(null);
  const [upload, setUpload] = useState<UploadState>(IDLE_UPLOAD);
  // Bumped on every pick (and on clearing); a reply applies only if the
  // counter still holds the value it was sent under.
  const pickRef = useRef(0);
  // The date this dialog filled in from a photo, if the field still holds
  // it. A new pick or a reset clears the field only while it matches, so
  // a date the member edited is never taken back.
  const prefilledRef = useRef<string | null>(null);
  // Latest-value refs, so the upload callback keeps a stable identity and
  // the effect below fires on a pick, never on a re-render.
  const uploadFnRef = useRef(uploadMut.mutateAsync);
  uploadFnRef.current = uploadMut.mutateAsync;
  const editPhotoId = seed?.mode === "edit" ? seed.photo.id : undefined;
  const editPhotoIdRef = useRef(editPhotoId);
  editPhotoIdRef.current = editPhotoId;

  const crop = useImageCrop({
    aspect: 4 / 3,
    outputWidth: ALBUM_OUTPUT_WIDTH,
    outputHeight: ALBUM_OUTPUT_HEIGHT,
  });

  // `crop.reset` is referentially stable (see `UseImageCropResult`), so
  // the seed effect below depends on it directly. This used to stash it
  // in a ref, because the hook handed back a fresh function every render
  // and depending on it looped.
  const { reset: resetCrop } = crop;

  // Re-seed the form whenever the dialog opens / the seed changes.
  // Also reset the crop UI on close so the previous photo's working
  // URL doesn't carry over.
  useEffect(() => {
    prefilledRef.current = null;
    setForm(seed === null ? null : seedToForm(seed));
    if (seed === null) {
      resetCrop();
    }
  }, [seed, resetCrop]);

  const clearPrefilledDate = useCallback(() => {
    const prefilled = prefilledRef.current;
    prefilledRef.current = null;
    if (prefilled !== null) {
      setForm((f) =>
        f && f.takenAt === prefilled ? { ...f, takenAt: "" } : f,
      );
    }
  }, []);

  const startUpload = useCallback(
    async (file: File) => {
      clearPrefilledDate();
      pickRef.current += 1;
      const pick = pickRef.current;
      setUpload({ status: "uploading", result: null, error: null });
      try {
        const photoId = editPhotoIdRef.current;
        const result = await uploadFnRef.current(
          photoId === undefined ? { file } : { file, photoId },
        );
        if (pick !== pickRef.current) {
          return;
        }
        setUpload({ status: "done", result, error: null });
        // Fill only a date the member hasn't touched.
        if (result.takenDate !== null) {
          const { takenDate } = result;
          setForm((f) => {
            if (f && f.takenAt === "") {
              prefilledRef.current = takenDate;
              return { ...f, takenAt: takenDate };
            }
            return f;
          });
        }
      } catch (err) {
        if (pick !== pickRef.current) {
          return;
        }
        // The transport rethrows whatever text the response carried, so
        // only known upload messages reach the member.
        setUpload({
          status: "error",
          result: null,
          error: uploadErrorMessage(err),
        });
      }
    },
    [clearPrefilledDate],
  );

  const { sourceFile } = crop;
  useEffect(() => {
    if (sourceFile === null) {
      clearPrefilledDate();
      pickRef.current += 1;
      setUpload(IDLE_UPLOAD);
      return;
    }
    void startUpload(sourceFile);
  }, [sourceFile, startUpload, clearPrefilledDate]);

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
    // A browser without a native date picker accepts free text, and the
    // wire conversion throws on a date that doesn't exist; say so rather
    // than leave an unhandled rejection and a Save that does nothing.
    const takenAt = takenDateOrInvalid(form.takenAt);
    if (takenAt === "invalid") {
      toast.error("Enter a real date, or leave it blank.");
      return;
    }

    const uploaded =
      sourceFile !== null && upload.status === "done" && upload.result
        ? {
            photoId: upload.result.photoId,
            originalKey: upload.result.originalKey,
            fullKey: upload.result.fullKey,
          }
        : null;
    // Edit sends the original only with a new crop.
    const original =
      seed.mode === "create" || imageDataUrl !== null ? uploaded : null;

    const base = {
      caption,
      credit,
      takenAt,
      tag,
      altText,
      widthPx: ALBUM_OUTPUT_WIDTH,
      heightPx: ALBUM_OUTPUT_HEIGHT,
    };

    try {
      if (seed.mode === "create") {
        if (!imageDataUrl) {
          toast.error("Pick a photo and complete the crop.");
          return;
        }
        await createMut.mutateAsync({
          ...base,
          imageDataUrl,
          ...(original ? { original } : {}),
        });
        toast.success("Photo uploaded.");
      } else {
        await updateMut.mutateAsync({
          publicId: seed.photo.publicId,
          ...base,
          ...(imageDataUrl ? { imageDataUrl } : {}),
          ...(original ? { original } : {}),
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
      // A failed save deletes the private objects it was sent, so those
      // keys are spent. Upload the same file again for fresh ones; Save
      // stays disabled until they land.
      if (original !== null && sourceFile !== null) {
        void startUpload(sourceFile);
      }
    }
  }

  const existingImageUrl =
    seed?.mode === "edit" ? albumImageUrl(seed.photo.imageKey) : null;

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
            id="album-photo-form"
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
                    className="max-h-[30dvh] max-w-full rounded-md sm:max-h-[40dvh]"
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
                <ImagePickerError message={crop.error} />
                {upload.status === "uploading" ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Uploading original…
                  </p>
                ) : null}
                {upload.status === "error" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <ImagePickerError message={upload.error} />
                    {sourceFile ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void startUpload(sourceFile)}
                      >
                        Try again
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="album-alt">Alt text (required)</Label>
                <Input
                  id="album-alt"
                  value={form.altText}
                  onChange={(e) =>
                    setForm({ ...form, altText: e.target.value })
                  }
                  placeholder="A short description of what's in the photo"
                  maxLength={300}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="album-caption">Caption (optional)</Label>
                <Textarea
                  id="album-caption"
                  value={form.caption}
                  onChange={(e) =>
                    setForm({ ...form, caption: e.target.value })
                  }
                  rows={2}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="album-credit">Credit (optional)</Label>
                <Input
                  id="album-credit"
                  value={form.credit}
                  onChange={(e) => setForm({ ...form, credit: e.target.value })}
                  placeholder="Photographer's name"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="album-taken-at">Date taken (optional)</Label>
                <Input
                  id="album-taken-at"
                  type="date"
                  value={form.takenAt}
                  onChange={(e) =>
                    setForm({ ...form, takenAt: e.target.value })
                  }
                />
                {upload.result?.takenDate &&
                form.takenAt === upload.result.takenDate ? (
                  <p className="text-xs text-muted-foreground">
                    From the photo
                  </p>
                ) : null}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="album-tag">Tag (optional)</Label>
                <Input
                  id="album-tag"
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  placeholder="climbing, paddling, caving, etc."
                  list="album-tag-suggestions"
                  maxLength={50}
                />
                {knownTags.length > 0 ? (
                  <datalist id="album-tag-suggestions">
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
            form="album-photo-form"
            disabled={
              submitting ||
              form === null ||
              upload.status === "uploading" ||
              upload.status === "error"
            }
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

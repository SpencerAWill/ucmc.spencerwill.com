/**
 * Avatar editor for the /account profile tab. Flow:
 *   1. user picks a file →
 *   2. `normalizeImageFile` fixes EXIF orientation and downsizes to a
 *      working size (8 MP iPhone shots otherwise blow up the <img> we
 *      hand to ReactCrop) →
 *   3. user picks a circular crop in a Dialog →
 *   4. we draw the crop into a 256×256 canvas, encode WebP at q=0.85 →
 *   5. POST as a `data:` URL via uploadAvatarFn.
 *
 * Steps 2 and 4 go through `#/lib/image-upload` rather than being
 * hand-rolled here, which is how they were written first. Three surfaces
 * had their own copy of this and each was broken on mobile Safari in a
 * different way; the module note explains what the shared version knows
 * about HEIC, worker decodes and `toBlob`'s silent PNG fallback.
 */
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import type { PercentCrop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { UserAvatar } from "#/components/user-avatar";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  removeAvatarFn,
  uploadAvatarFn,
} from "#/features/auth/server/server-fns";
import {
  encodeCanvasToDataUrl,
  IMAGE_UPLOAD_ACCEPT,
  imageUploadErrorMessage,
  normalizeImageFile,
} from "#/lib/image-upload";

const OUTPUT_SIZE = 256;
const OUTPUT_QUALITY = 0.85;
const WORKING_MAX_DIMENSION = 1600;

export interface AvatarEditorProps {
  avatarKey: string | null;
  name: string | null;
  onChanged?: () => void | Promise<void>;
}

export function AvatarEditor({
  avatarKey,
  name,
  onChanged,
}: AvatarEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [workingUrl, setWorkingUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<PercentCrop | undefined>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>();
  const [busy, setBusy] = useState(false);

  function reset() {
    if (workingUrl) {
      URL.revokeObjectURL(workingUrl);
    }
    setWorkingUrl(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      // Normalizes EXIF orientation (canvas alone rotates iPhone photos
      // sideways) and shrinks the working image to keep the crop UI snappy.
      const normalized = await normalizeImageFile(file, {
        maxDimension: WORKING_MAX_DIMENSION,
        fileType: "image/jpeg",
      });
      setWorkingUrl(URL.createObjectURL(normalized));
    } catch (err) {
      // The real reason, not a fixed string: on a phone this is usually
      // an oversized file or a decode the platform can't do, and each
      // wants a different next step from the member.
      toast.error(imageUploadErrorMessage(err));
      reset();
    }
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(
      centerCrop(
        makeAspectCrop(
          { unit: "%", width: 80 },
          1,
          naturalWidth,
          naturalHeight,
        ),
        naturalWidth,
        naturalHeight,
      ),
    );
  }

  async function uploadCrop() {
    const image = imgRef.current;
    if (!image || !completedCrop || completedCrop.width === 0) {
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await renderCroppedWebp(image, completedCrop);
      await uploadAvatarFn({ data: { dataUrl } });
      toast.success("Avatar updated");
      reset();
      await onChanged?.();
    } catch (err) {
      // An `ImageUploadError` is already member-facing, so it passes
      // through; a server rejection keeps its message because the avatar
      // action's are written to be read ("Avatar exceeds … bytes").
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t upload your avatar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      await removeAvatarFn();
      toast.success("Avatar removed");
      await onChanged?.();
    } catch {
      toast.error("Couldn’t remove your avatar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        avatarKey={avatarKey}
        name={name}
        className="size-20"
        fallbackClassName="text-lg"
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="mr-1.5 size-4" />
            {avatarKey ? "Change photo" : "Upload photo"}
          </Button>
          {avatarKey ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeAvatar}
              disabled={busy}
            >
              <Trash2 className="mr-1.5 size-4" />
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          A square photo of your face works best. Max 1 minute, max 5 uploads
          per minute.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        onChange={onFileChosen}
      />

      <Dialog
        open={workingUrl !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            reset();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
          </DialogHeader>
          {workingUrl ? (
            <div className="flex justify-center">
              <ReactCrop
                crop={crop}
                onChange={(_, percent) => setCrop(percent)}
                onComplete={(pixel) => setCompletedCrop(pixel)}
                aspect={1}
                circularCrop
                keepSelection
              >
                {/* onLoad fires the initial crop calculation once the
                    image is decoded — not a user interaction, but the
                    rule flags every listener on a non-interactive
                    element regardless of semantics. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                <img
                  ref={imgRef}
                  src={workingUrl}
                  alt="Selected file, awaiting crop"
                  onLoad={onImageLoad}
                  className="max-h-[60dvh] max-w-full"
                />
              </ReactCrop>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={reset}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={uploadCrop} disabled={busy}>
              {busy ? "Uploading…" : "Use photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function renderCroppedWebp(
  image: HTMLImageElement,
  crop: PixelCrop,
): Promise<string> {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const sx = crop.x * scaleX;
  const sy = crop.y * scaleY;
  const sw = crop.width * scaleX;
  const sh = crop.height * scaleY;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not available in this browser");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  // `encodeCanvasToDataUrl` checks that the browser actually produced
  // WebP: `toBlob` falls back to PNG silently on an unsupported type,
  // and `DATA_URL_RE` in the avatar action would then reject it with a
  // message about content types that means nothing to a member.
  return await encodeCanvasToDataUrl(canvas, OUTPUT_QUALITY);
}

/**
 * Avatar editor for the /account profile tab. Flow:
 *   1. user picks a file →
 *   2. browser-image-compression normalizes orientation + downsizes to a
 *      reasonable working size (8 MP iPhone shots otherwise blow up the
 *      <img> we hand to ReactCrop) →
 *   3. user picks a circular crop in a Dialog →
 *   4. we draw the crop into a 256×256 canvas, encode WebP at q=0.85 →
 *   5. POST as a `data:` URL via uploadAvatarFn.
 */
import imageCompression from "browser-image-compression";
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import type { PercentCrop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { UserAvatar } from "#/features/auth/components/user-avatar";
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
      const normalized = await imageCompression(file, {
        maxWidthOrHeight: WORKING_MAX_DIMENSION,
        useWebWorker: true,
        fileType: "image/jpeg",
      });
      setWorkingUrl(URL.createObjectURL(normalized));
    } catch {
      toast.error("Couldn’t read that image. Try another file.");
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
        accept="image/*"
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
                <img
                  ref={imgRef}
                  src={workingUrl}
                  alt="Photo to crop"
                  onLoad={onImageLoad}
                  className="max-h-[60vh] max-w-full"
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

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
      "image/webp",
      OUTPUT_QUALITY,
    );
  });
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

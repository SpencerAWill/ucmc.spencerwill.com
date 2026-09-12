/**
 * Headless "fit an image inside a box, don't crop it" upload logic —
 * the counterpart to {@link useImageCrop} for images whose aspect ratio
 * is part of the content rather than a layout choice.
 *
 * Sponsor logos are the motivating case (issue #185). A wordmark is
 * wide, a roundel is square, and a stacked mark is tall; cropping any of
 * them to a shared aspect ratio either slices lettering off or
 * letterboxes the mark into its own bounding box. So this hook scales
 * the source down to fit a max box, preserves the original ratio, and
 * reports the output dimensions so the card can reserve the right space.
 *
 * Differences from `useImageCrop` that are deliberate, not oversights:
 *
 *   - **No `react-image-crop`, and no crop UI at all.** There is nothing
 *     to select; the preview is the result.
 *   - **Alpha is preserved.** The canvas is never filled before the
 *     draw, and WebP carries an alpha channel, so a logo supplied as a
 *     transparent PNG stays transparent. `useImageCrop` normalizes its
 *     source through a JPEG working copy, which would flatten it onto
 *     black.
 *   - **The source is decoded directly rather than pre-compressed
 *     through `browser-image-compression`.** That library's pre-pass
 *     exists to make a multi-megapixel camera photo cheap to crop
 *     interactively and to fix EXIF orientation — neither applies to a
 *     logo, and routing through it would cost the alpha channel. The
 *     byte cap below stands in for the memory guard.
 *
 * Layout of the picker and preview is left to the caller; this hook
 * supplies the ref, props, and the encoded result.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

const OUTPUT_QUALITY = 0.92;

/**
 * Reject an oversized source before decoding it. A decoded bitmap costs
 * ~4 bytes per pixel, so this is the guard that keeps a 50 MB TIFF-ish
 * PNG from allocating gigabytes in a phone browser.
 */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export interface UseImageResizeOptions {
  /**
   * Longest-edge cap for the stored image, in pixels. The result is
   * scaled to fit within a `maxDimension` square, preserving aspect.
   * An image already inside the box is left at its natural size rather
   * than being scaled *up* — upscaling a small logo only adds bytes.
   */
  maxDimension: number;
}

export interface ResizedImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export interface UseImageResizeResult {
  /** Object URL of the chosen source, for a preview. */
  previewUrl: string | null;
  /** The encoded result, available as soon as a file is chosen. */
  result: ResizedImage | null;
  /** Set when the chosen file was rejected (too big, not an image). */
  error: string | null;
  /** True while the chosen file is being decoded and re-encoded. */
  isProcessing: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  openPicker: () => void;
  /** Clear the chosen file, preview, result and error. */
  reset: () => void;
  /** Spread on a hidden `<input type="file">`. */
  fileInputProps: {
    type: "file";
    accept: string;
    className: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
}

export function useImageResize(
  options: UseImageResizeOptions,
): UseImageResizeResult {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ResizedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Revoke the object URL when it changes or the hook unmounts, so
  // repeated picks don't leak browser-side blobs.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  /**
   * **Stable across renders, and that is load-bearing.**
   *
   * This was a plain function in the hook body, so it got a fresh
   * identity on every render. `SponsorFormDialog` listed it in a
   * `useEffect` dep array and that effect calls `setForm(seedToForm(seed))`
   * — a new object literal, which React can never bail out of — so
   * opening the dialog looped: render → effect → setState → render → new
   * `reset` identity → effect → … until React threw #185 ("Maximum
   * update depth exceeded"). Any callback a hook hands back can end up in
   * a consumer's dep array, so it has to be `useCallback`'d.
   *
   * The dep array is empty rather than `[previewUrl]`, which is what
   * keeps the identity stable for the life of the hook. That means the
   * revoke can't happen here — clearing `previewUrl` is enough, because
   * the effect above revokes the previous URL as its cleanup whenever the
   * value changes.
   */
  const reset = useCallback(() => {
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    if (file.size > MAX_SOURCE_BYTES) {
      setError("That image is too large. Pick one under 12 MB.");
      return;
    }
    setIsProcessing(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const resized = await resizeToFit(objectUrl, options.maxDimension);
      setPreviewUrl(objectUrl);
      setResult(resized);
    } catch {
      URL.revokeObjectURL(objectUrl);
      setError("That file couldn't be read as an image.");
    } finally {
      setIsProcessing(false);
    }
  }

  return {
    previewUrl,
    result,
    error,
    isProcessing,
    fileInputRef,
    openPicker: () => fileInputRef.current?.click(),
    reset,
    fileInputProps: {
      type: "file",
      // Narrower than `image/*`: the encode path accepts anything the
      // browser can decode, but SVG is deliberately excluded. It would
      // rasterize fine here, yet accepting it invites someone to wire a
      // pass-through later, and an inline SVG is a script-execution
      // surface on a page anonymous visitors load.
      accept: "image/png,image/jpeg,image/webp",
      className: "hidden",
      onChange: onFileChosen,
    },
  };
}

/**
 * Decode `objectUrl`, scale it to fit a `maxDimension` square preserving
 * aspect, and re-encode as WebP.
 *
 * Exported for testing. Never scales up: `Math.min(scale, 1)` means an
 * image already inside the box is re-encoded at its natural size.
 */
export async function resizeToFit(
  objectUrl: string,
  maxDimension: number,
): Promise<ResizedImage> {
  const image = await loadImage(objectUrl);
  const { naturalWidth, naturalHeight } = image;
  if (naturalWidth === 0 || naturalHeight === 0) {
    throw new Error("Image has no intrinsic size");
  }
  const scale = Math.min(
    maxDimension / naturalWidth,
    maxDimension / naturalHeight,
    1,
  );
  // Round, then floor at 1: a very wide banner scaled to fit could
  // otherwise round its short edge to 0 and produce a zero-area canvas.
  const widthPx = Math.max(1, Math.round(naturalWidth * scale));
  const heightPx = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not available in this browser");
  }
  // No `fillRect` first — an unfilled canvas starts fully transparent,
  // which is what keeps a transparent logo transparent.
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, widthPx, heightPx);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
      "image/webp",
      OUTPUT_QUALITY,
    );
  });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { dataUrl, widthPx, heightPx };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import {
  clampWorkingDimension,
  encodeCanvasToDataUrl,
  IMAGE_UPLOAD_ACCEPT,
  imageUploadErrorMessage,
  MAX_SOURCE_BYTES,
} from "#/lib/image-upload";

const OUTPUT_QUALITY = 0.92;

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

/**
 * **Every function and props object on this result is referentially
 * stable**, changing identity only when something it actually depends on
 * changes — never merely because the component re-rendered.
 *
 * That is a contract, not an implementation detail, and this hook is
 * where it was learned: `reset` shipped as a plain function, a consumer
 * put it in a `useEffect` dep array, and opening the sponsor form looped
 * until React threw #185. Keep new members `useCallback`/`useMemo`-wrapped.
 * The same note is on {@link UseImageCropResult}.
 *
 * The *result object itself* is still a fresh literal each render, so
 * depend on the member you need, not the whole object.
 */
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
  // Destructured to a primitive up front: callers pass `options` as an
  // object literal, so depending on it would defeat the memoization.
  const { maxDimension } = options;
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

  const onFileChosen = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      setError(null);
      if (file.size > MAX_SOURCE_BYTES) {
        setError(
          `That image is too large. Pick one under ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`,
        );
        return;
      }
      setIsProcessing(true);
      const objectUrl = URL.createObjectURL(file);
      try {
        const resized = await resizeToFit(objectUrl, maxDimension);
        setPreviewUrl(objectUrl);
        setResult(resized);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        // The message comes from the thrown error rather than being a
        // fixed string: "couldn't be read as an image" is wrong for the
        // two failures a phone actually hits — an unsupported WebP
        // encoder and a canvas over the platform's area cap — and a
        // member told the wrong cause just retries the same file.
        setError(imageUploadErrorMessage(err));
      } finally {
        setIsProcessing(false);
      }
    },
    [maxDimension],
  );

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);

  const fileInputProps = useMemo(
    () => ({
      type: "file" as const,
      // Narrower than `image/*` — see `IMAGE_UPLOAD_ACCEPT` for both
      // reasons (SVG is a script-execution surface; a generic `image/*`
      // makes iOS hand over an undecodable HEIC).
      accept: IMAGE_UPLOAD_ACCEPT,
      className: "hidden",
      onChange: onFileChosen,
    }),
    [onFileChosen],
  );

  return {
    previewUrl,
    result,
    error,
    isProcessing,
    fileInputRef,
    openPicker,
    reset,
    fileInputProps,
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
  // Clamped against the platform's canvas-area cap: past it, iOS Safari
  // doesn't throw — `drawImage` paints nothing — so an unclamped
  // `maxDimension` yields a blank logo rather than an error.
  const bound = clampWorkingDimension(maxDimension);
  const scale = Math.min(bound / naturalWidth, bound / naturalHeight, 1);
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

  // `encodeCanvasToDataUrl` rather than an inline `toBlob`: an
  // unsupported type falls back to PNG silently, and a lossless PNG of
  // the same logo clears the sponsor action's 1.4 MB data-URL cap, which
  // surfaced to the member as a Zod string-too-long error.
  const dataUrl = await encodeCanvasToDataUrl(canvas, OUTPUT_QUALITY);
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

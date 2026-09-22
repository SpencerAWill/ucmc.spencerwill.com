/**
 * Headless image-crop logic shared by every editor that uploads a
 * cropped image — the landing CMS (hero slides, activities, about,
 * meeting info) and the Album's photo form.
 *
 * It lived in features/landing until the import-boundary zones were
 * generated rather than hand-enumerated, which surfaced that
 * features/album had been reaching across for it. The hook is
 * entirely feature-blind, so src/hooks/ is its real home.
 *
 * The hook owns:
 *   - the hidden file input + the working object URL
 *   - the crop selection (state + handlers for ReactCrop)
 *   - a `getCroppedDataUrl()` that the caller invokes on submit to render
 *     the final WebP data URL.
 *
 * Visual layout of the crop UI is left to the caller — this hook just
 * supplies the ref, props, and rendering function.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import { centerCrop, makeAspectCrop } from "react-image-crop";
import type { PercentCrop, PixelCrop } from "react-image-crop";

import {
  encodeCanvasToDataUrl,
  IMAGE_UPLOAD_ACCEPT,
  imageUploadErrorMessage,
  normalizeImageFile,
} from "#/lib/image-upload";

/**
 * Requested working size. `normalizeImageFile` clamps it down to what
 * the platform's canvas can actually hold — 2400² is 5.76 M px, over
 * iOS Safari's low canvas-area cap, and past that cap the crop UI shows
 * a blank image rather than failing.
 */
const WORKING_MAX_DIMENSION = 2400;
const OUTPUT_QUALITY = 0.85;

export interface UseImageCropOptions {
  /** Crop aspect ratio (width / height). e.g. 16/9 or 4/3. */
  aspect: number;
  /** Final encoded image width in pixels. */
  outputWidth: number;
  /** Final encoded image height in pixels. */
  outputHeight: number;
}

/**
 * **Every function and props object on this result is referentially
 * stable**, changing identity only when something it actually depends on
 * changes — never merely because the component re-rendered.
 *
 * That is a contract, not an implementation detail. These callbacks end
 * up in consumers' `useEffect` dep arrays, and an effect that calls
 * `setState` with a fresh object will loop forever against a callback
 * whose identity churns every render: render → effect → setState →
 * render → new identity → effect → … until React throws #185, "Maximum
 * update depth exceeded". That is precisely what `useImageResize` — this
 * hook's contain-not-crop sibling — shipped and crashed on, and what
 * `photo-form-dialog` had been working around by stashing `reset` in a
 * ref. Keep new members `useCallback`/`useMemo`-wrapped.
 *
 * The *result object itself* is still a fresh literal each render, so
 * depend on the member you need (`crop.reset`), not the whole object.
 */
export interface UseImageCropResult {
  workingUrl: string | null;
  /**
   * Set when the picked file was rejected or couldn't be decoded, and
   * cleared on the next pick. Callers must render it: before it existed
   * `onFileChosen` was an `async` handler with no `catch`, so every
   * decode failure became an unhandled promise rejection — the picker
   * closed, nothing appeared, and the only trace was a library-internal
   * message in the console. That is the whole of the "image uploads
   * throw weird errors on iOS" report.
   */
  error: string | null;
  crop: PercentCrop | undefined;
  imgRef: React.RefObject<HTMLImageElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  hasCompletedCrop: boolean;
  /** Open the file picker. */
  openPicker: () => void;
  /** Reset state — clears working URL, crop, and the file input. */
  reset: () => void;
  /** Spread on a hidden `<input type="file">`. */
  fileInputProps: {
    type: "file";
    accept: string;
    className: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  /** Spread on `<ReactCrop>`. */
  reactCropProps: {
    crop: PercentCrop | undefined;
    onChange: (_: PixelCrop, percent: PercentCrop) => void;
    onComplete: (pixel: PixelCrop) => void;
    aspect: number;
    keepSelection: true;
  };
  /** Spread on the `<img>` rendered inside `<ReactCrop>`. */
  imgProps: {
    ref: React.RefObject<HTMLImageElement | null>;
    src: string;
    alt: string;
    onLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
    className: string;
  };
  /**
   * Render the current crop to a WebP data URL. Returns `null` if the
   * user hasn't finished a crop selection yet.
   */
  getCroppedDataUrl: () => Promise<string | null>;
}

export function useImageCrop(options: UseImageCropOptions): UseImageCropResult {
  // Destructured to primitives up front. Callers pass `options` as an
  // object literal, so it has a fresh identity every render — depending
  // on it anywhere below would defeat every `useCallback` here.
  const { aspect, outputWidth, outputHeight } = options;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [workingUrl, setWorkingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<PercentCrop | undefined>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>();

  // Revoke the object URL when it changes or the hook unmounts so we
  // don't leak browser-side blobs across uploads.
  useEffect(() => {
    return () => {
      if (workingUrl) {
        URL.revokeObjectURL(workingUrl);
      }
    };
  }, [workingUrl]);

  /**
   * Stable for the life of the hook — see the note on the return value.
   *
   * The empty dep array is what buys that, which is why the revoke isn't
   * here: clearing `workingUrl` is enough, because the effect above
   * revokes the previous URL as its cleanup whenever the value changes.
   */
  const reset = useCallback(() => {
    setWorkingUrl(null);
    setError(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onFileChosen = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    try {
      // Normalized to JPEG rather than left alone: the result is only
      // ever drawn into a canvas, so alpha is irrelevant here, and the
      // round trip is what fixes EXIF orientation — a canvas ignores
      // the rotation tag, so an iPhone portrait photo would crop
      // sideways.
      const normalized = await normalizeImageFile(file, {
        maxDimension: WORKING_MAX_DIMENSION,
        fileType: "image/jpeg",
      });
      setWorkingUrl(URL.createObjectURL(normalized));
    } catch (err) {
      // An `async` onChange handler that throws produces an unhandled
      // rejection and nothing else — no state change, no message, and a
      // dialog that just sits there. Landing it in `error` is what makes
      // the failure visible.
      setError(imageUploadErrorMessage(err));
    }
  }, []);

  const onImageLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      setCrop(
        centerCrop(
          makeAspectCrop(
            { unit: "%", width: 90 },
            aspect,
            naturalWidth,
            naturalHeight,
          ),
          naturalWidth,
          naturalHeight,
        ),
      );
    },
    [aspect],
  );

  const getCroppedDataUrl = useCallback(async (): Promise<string | null> => {
    const image = imgRef.current;
    if (!image || !completedCrop || completedCrop.width === 0) {
      return null;
    }
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const sx = completedCrop.x * scaleX;
    const sy = completedCrop.y * scaleY;
    const sw = completedCrop.width * scaleX;
    const sh = completedCrop.height * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not available in this browser");
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

    // Not an inline `toBlob`: an unsupported `type` makes it fall back
    // to PNG *silently*, and the album action accepts only
    // `data:image/webp`, so the failure surfaced from a server-side
    // validator instead of from here.
    return await encodeCanvasToDataUrl(canvas, OUTPUT_QUALITY);
    // Identity changes only when the completed crop or the output size
    // does, never on an unrelated render — a consumer can hold this in a
    // dep array and get one re-run per actual crop change.
  }, [completedCrop, outputWidth, outputHeight]);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);

  const fileInputProps = useMemo(
    () => ({
      type: "file" as const,
      // Not `image/*`: that makes the iOS Photos picker hand over the
      // original HEIC, which nothing downstream can decode. An explicit
      // list without HEIC makes iOS transcode to JPEG on selection.
      accept: IMAGE_UPLOAD_ACCEPT,
      className: "hidden",
      onChange: onFileChosen,
    }),
    [onFileChosen],
  );

  const reactCropProps = useMemo(
    () => ({
      crop,
      onChange: (_pixel: PixelCrop, percent: PercentCrop) => setCrop(percent),
      onComplete: (pixel: PixelCrop) => setCompletedCrop(pixel),
      aspect,
      keepSelection: true as const,
    }),
    [crop, aspect],
  );

  const imgProps = useMemo(
    () => ({
      ref: imgRef,
      src: workingUrl ?? "",
      alt: "Image to crop",
      onLoad: onImageLoad,
      // Cap the cropper image so it doesn't dominate the viewport on
      // phones (`30dvh`) but can still breathe on desktop (`40vh`).
      // `dvh` accounts for mobile browser chrome — `vh` would let the
      // image push the form fields off-screen when the URL bar
      // appears.
      className: "max-h-[30dvh] max-w-full sm:max-h-[40vh]",
    }),
    [workingUrl, onImageLoad],
  );

  return {
    workingUrl,
    error,
    crop,
    imgRef,
    fileInputRef,
    hasCompletedCrop: Boolean(completedCrop && completedCrop.width > 0),
    openPicker,
    reset,
    fileInputProps,
    reactCropProps,
    imgProps,
    getCroppedDataUrl,
  };
}

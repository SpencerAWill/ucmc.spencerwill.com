/**
 * Headless image-crop logic shared by editors that upload landing images.
 * The hook owns:
 *   - the hidden file input + the working object URL
 *   - the crop selection (state + handlers for ReactCrop)
 *   - a `getCroppedDataUrl()` that the caller invokes on submit to render
 *     the final WebP data URL.
 *
 * Visual layout of the crop UI is left to the caller — this hook just
 * supplies the ref, props, and rendering function.
 */
import imageCompression from "browser-image-compression";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import { centerCrop, makeAspectCrop } from "react-image-crop";
import type { PercentCrop, PixelCrop } from "react-image-crop";

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

export interface UseImageCropResult {
  workingUrl: string | null;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [workingUrl, setWorkingUrl] = useState<string | null>(null);
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

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const normalized = await imageCompression(file, {
      maxWidthOrHeight: WORKING_MAX_DIMENSION,
      useWebWorker: true,
      fileType: "image/jpeg",
    });
    setWorkingUrl(URL.createObjectURL(normalized));
  }

  function onImageLoad(e: SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(
      centerCrop(
        makeAspectCrop(
          { unit: "%", width: 90 },
          options.aspect,
          naturalWidth,
          naturalHeight,
        ),
        naturalWidth,
        naturalHeight,
      ),
    );
  }

  async function getCroppedDataUrl(): Promise<string | null> {
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
    canvas.width = options.outputWidth;
    canvas.height = options.outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not available in this browser");
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      options.outputWidth,
      options.outputHeight,
    );

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
        "image/webp",
        OUTPUT_QUALITY,
      );
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  return {
    workingUrl,
    crop,
    imgRef,
    fileInputRef,
    hasCompletedCrop: Boolean(completedCrop && completedCrop.width > 0),
    openPicker: () => fileInputRef.current?.click(),
    reset,
    fileInputProps: {
      type: "file",
      accept: "image/*",
      className: "hidden",
      onChange: onFileChosen,
    },
    reactCropProps: {
      crop,
      onChange: (_pixel, percent) => setCrop(percent),
      onComplete: (pixel) => setCompletedCrop(pixel),
      aspect: options.aspect,
      keepSelection: true,
    },
    imgProps: {
      ref: imgRef,
      src: workingUrl ?? "",
      alt: "Image to crop",
      onLoad: onImageLoad,
      className: "max-h-[40vh] max-w-full",
    },
    getCroppedDataUrl,
  };
}

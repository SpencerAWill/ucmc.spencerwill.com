/**
 * Client-side "turn a picked file into bytes the server will accept"
 * helpers, shared by every image upload surface.
 *
 * This exists because the same ~40 lines had been written three times —
 * `useImageCrop`, `useImageResize`, and `avatar-editor`'s private
 * `renderCroppedWebp` — and each copy was fragile on mobile Safari in a
 * *different* way. The lesson of that is the reason this is one module
 * rather than a fourth copy: the browser-compatibility knowledge below is
 * not obvious, and it has to be in one place to stay true.
 *
 * Three mobile-specific hazards are handled here:
 *
 * 1. **HEIC.** iOS stores camera photos as HEIC/HEIF. Which bytes the
 *    Photos picker hands over depends on the input's `accept`: with a
 *    generic `image/*` iOS passes the original HEIC through untouched,
 *    but with an explicit list that omits HEIC it transcodes to JPEG on
 *    selection. So {@link IMAGE_UPLOAD_ACCEPT} is an explicit list, and
 *    `image/*` is a bug rather than a convenience — nothing downstream
 *    of here can decode HEIC, and every server path validates the
 *    declared content type against magic bytes.
 *
 * 2. **The Web Worker decode path.** `browser-image-compression` prefers
 *    an `OffscreenCanvas` in a worker, which is both faster and how it
 *    fixes EXIF orientation. That path is the one most likely to fail on
 *    an older or memory-pressured mobile Safari, and the failure is a
 *    worker-internal rejection with no useful message. So
 *    {@link normalizeImageFile} retries once on the main thread before
 *    giving up: slower, but it is the difference between a working
 *    upload and an unexplained error.
 *
 * 3. **`toBlob` type fallback.** Per the HTML spec, `canvas.toBlob` with
 *    an unsupported `type` does not fail — it silently encodes PNG
 *    instead and reports that in `blob.type`. Every caller here wants
 *    WebP, and the album and sponsor server paths accept *only* WebP
 *    (`WEBP_DATA_URL_RE`) or cap the data URL at 1.4 MB, which a
 *    lossless PNG of the same image clears easily. Unchecked, that
 *    surfaced to the member as "Image data URL is not the expected
 *    image/webp shape" or a Zod string-too-long error. {@link
 *    encodeCanvasToDataUrl} checks what it actually got.
 */
import imageCompression from "browser-image-compression";

/**
 * `accept` for every image `<input type="file">` in the app.
 *
 * Deliberately not `image/*`, for the HEIC reason above, and
 * deliberately without SVG: it would rasterize fine through a canvas,
 * but accepting it invites someone to wire a pass-through later, and an
 * inline SVG is a script-execution surface on pages anonymous visitors
 * load.
 */
export const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * Reject an oversized source before decoding it. A decoded bitmap costs
 * ~4 bytes per pixel, so this is the guard that keeps a 50 MB PNG from
 * allocating gigabytes in a phone browser.
 */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/**
 * Conservative ceiling on the pixel area of any canvas we allocate.
 *
 * iOS Safari caps total canvas area and, past the cap, does not throw:
 * `drawImage` paints nothing and `toBlob` hands back a blank image or
 * `null`. The documented limit is 16.7 M px on devices with ≥2 GB of
 * RAM and 5 M px below that, so this sits under the *lower* figure —
 * there is no way to feature-detect which one applies, and the penalty
 * for guessing high is a silently blank upload.
 */
export const MAX_CANVAS_AREA = 4_000_000;

/**
 * A failure with a message worth showing a member.
 *
 * The point of the class is the boundary: everything below converts the
 * library's and the platform's internal errors into one of these, so a
 * caller can render `err.message` directly instead of choosing between
 * leaking "t.getImageData is not a function" and swallowing the reason.
 */
export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

/**
 * Largest working dimension that keeps `maxDimension²` inside
 * {@link MAX_CANVAS_AREA}. Callers pass the size they'd *like*; a
 * 2400px square working image is 5.76 M px, over the low iOS cap, so
 * asking for it on a phone is how you get a blank crop.
 */
export function clampWorkingDimension(maxDimension: number): number {
  return Math.min(maxDimension, Math.floor(Math.sqrt(MAX_CANVAS_AREA)));
}

/**
 * Decode a picked file, fix its EXIF orientation, and downscale it to a
 * working size — the step every upload surface needs before it can show
 * a preview or a crop UI.
 *
 * Orientation is the reason this goes through the library at all rather
 * than straight to a canvas: a canvas ignores the EXIF rotation tag, so
 * an iPhone portrait photo cropped directly arrives sideways.
 *
 * `fileType` is passed through because the two callers want different
 * things: the crop path normalizes to JPEG (it only ever draws the
 * result into a canvas), while a logo must stay in an alpha-carrying
 * format or a transparent PNG gets flattened onto black.
 */
export async function normalizeImageFile(
  file: File,
  options: { maxDimension: number; fileType?: "image/jpeg" | "image/png" },
): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageUploadError(
      `That image is ${Math.round(file.size / 1024 / 1024)} MB. Pick one under ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`,
    );
  }

  const settings = {
    maxWidthOrHeight: clampWorkingDimension(options.maxDimension),
    ...(options.fileType ? { fileType: options.fileType } : {}),
  };

  try {
    return await imageCompression(file, { ...settings, useWebWorker: true });
  } catch {
    // The worker path is the fragile one on mobile Safari — see the
    // module note. Retrying on the main thread is slower and blocks for
    // a moment on a large photo, but it is the fallback that makes an
    // upload from a phone work at all, and by this point the
    // alternative is showing the member an error.
    try {
      return await imageCompression(file, {
        ...settings,
        useWebWorker: false,
      });
    } catch {
      throw new ImageUploadError(
        "That image couldn’t be read. If it came from an iPhone, try taking a screenshot of it and uploading that instead.",
      );
    }
  }
}

/**
 * Encode a canvas as a WebP `data:` URL, failing loudly if the browser
 * gave us something else.
 *
 * The `blob.type` check is the whole reason this isn't inline at the
 * three call sites: an unsupported `type` makes `toBlob` fall back to
 * PNG silently, and the resulting error lands several layers away in a
 * server-side Zod validator whose message means nothing to a member.
 */
export async function encodeCanvasToDataUrl(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new ImageUploadError(
                "This browser couldn’t encode that image. Try a different browser or a smaller photo.",
              ),
            ),
      "image/webp",
      quality,
    );
  });

  if (blob.type !== "image/webp") {
    throw new ImageUploadError(
      "This browser can’t save images in WebP format, which this upload requires. Try updating it, or use a different browser.",
    );
  }

  return await blobToDataUrl(blob);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(
        new ImageUploadError(
          reader.error?.message ?? "That image couldn’t be read.",
        ),
      );
    reader.readAsDataURL(blob);
  });
}

/**
 * Message for a member, from anything the upload path threw.
 *
 * Callers render this rather than branching on the error themselves,
 * which is what keeps a library-internal message — the "weird error"
 * this whole module exists to stop — from reaching a toast.
 */
export function imageUploadErrorMessage(err: unknown): string {
  return err instanceof ImageUploadError
    ? err.message
    : "That image couldn’t be uploaded. Try another file.";
}

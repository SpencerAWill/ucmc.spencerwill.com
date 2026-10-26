/**
 * The only upload failures a member is shown verbatim.
 *
 * Client-safe on purpose (no server imports): the server throws these and
 * the dialog allow-lists them. Anything else that reaches the client, such
 * as a D1 or R2 error, an HTML 5xx page or "Failed to fetch", is replaced
 * by one generic line, because the transport rethrows whatever text the
 * response carried.
 */
import { MAX_SOURCE_BYTES } from "#/lib/image-upload";

const MB = 1024 * 1024;

export const UPLOAD_RATE_LIMITED =
  "Too many photo uploads, try again in a minute.";
export const UPLOAD_NO_FILE = "Choose a photo to upload.";
export const UPLOAD_NOT_AN_IMAGE = "That file isn't a JPEG, PNG or WebP image.";
export const UPLOAD_PHOTO_GONE = "That photo no longer exists.";
export const UPLOAD_STORE_FAILED = "Couldn't store the photo. Try again.";
export const UPLOAD_GENERIC_FAILURE =
  "Couldn't upload the photo. Check your connection and try again.";

/** Carries the file's size, so it is a function and matched by shape. */
export function uploadTooLargeMessage(sizeBytes: number): string {
  return `That image is ${Math.ceil(sizeBytes / MB)} MB. Pick one under ${Math.round(MAX_SOURCE_BYTES / MB)} MB.`;
}

const FIXED_MESSAGES: ReadonlySet<string> = new Set([
  UPLOAD_RATE_LIMITED,
  UPLOAD_NO_FILE,
  UPLOAD_NOT_AN_IMAGE,
  UPLOAD_PHOTO_GONE,
  UPLOAD_STORE_FAILED,
]);

const TOO_LARGE = /^That image is \d+ MB\. Pick one under \d+ MB\.$/;

/** The text to show for a failed upload: a known message, else the generic line. */
export function uploadErrorMessage(err: unknown): string {
  if (
    err instanceof Error &&
    (FIXED_MESSAGES.has(err.message) || TOO_LARGE.test(err.message))
  ) {
    return err.message;
  }
  return UPLOAD_GENERIC_FAILURE;
}

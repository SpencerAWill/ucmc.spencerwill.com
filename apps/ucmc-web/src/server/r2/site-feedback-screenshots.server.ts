import { getPrivateBucket } from "#/server/r2";

/**
 * Screenshots attached to site-feedback bug reports. The private bucket's
 * first prefix: the image can show anything on the member's screen, so it
 * is read only through `/api/site-feedback/:id/screenshot`, which checks
 * the viewer is the submitter or a site maintainer.
 *
 * Agreed by this module, the read route (which looks the key up from the
 * row rather than re-prepending it), and the retention sweeps in
 * `server/cron/retention.server.ts` (30 days after resolution, plus an
 * orphan pass over this prefix).
 */
export const SITE_FEEDBACK_SCREENSHOT_PREFIX = "site-feedback/screenshots/";

/** R2's batch-delete ceiling. */
const DELETE_CHUNK = 1000;

export function siteFeedbackScreenshotKey(
  feedbackId: string,
  contentType: "image/webp" | "image/jpeg",
): string {
  const ext = contentType === "image/jpeg" ? "jpg" : "webp";
  return `${SITE_FEEDBACK_SCREENSHOT_PREFIX}${feedbackId}.${ext}`;
}

export async function putSiteFeedbackScreenshot(
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await getPrivateBucket().put(key, bytes, {
    httpMetadata: { contentType },
  });
}

export async function deleteSiteFeedbackScreenshots(
  keys: readonly string[],
): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    await getPrivateBucket().delete(keys.slice(i, i + DELETE_CHUNK));
  }
}

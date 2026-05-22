import { getPublicBucket } from "#/server/r2";

/**
 * Hard upper bound on R2 object size for Gazette PDFs. Defense-in-
 * depth — the action layer validates payload size before the worker
 * even reaches this helper (Zod cap on the decoded dataUrl). 10 MB
 * comfortably fits a 20-page newsletter with photos; raising the cap
 * means moving to presigned R2 uploads to dodge the worker request
 * body limit, which is a follow-up.
 */
export const GAZETTE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * R2 layout: `gazette/<id>/<contentHash>.pdf`. The `id` segment is
 * the gazette_issues.id row PK so `r2 object list --prefix gazette/<id>/`
 * cheaply finds every PDF version ever associated with one issue
 * (replacement uploads create a new key but the row's pdfKey only
 * points at the latest). The contentHash makes the key immutable;
 * combined with `cacheControl: immutable` at upload time, CDN caches
 * can hold the bytes effectively forever.
 */
export function gazettePdfKey(id: string, contentHash: string): string {
  return `gazette/${id}/${contentHash}.pdf`;
}

export async function putGazettePdf(
  key: string,
  bytes: ArrayBuffer,
): Promise<void> {
  if (bytes.byteLength > GAZETTE_MAX_BYTES) {
    throw new Error(
      `Gazette PDF exceeds ${GAZETTE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  await getPublicBucket().put(key, bytes, {
    // Cache-Control is set at upload time because the public bucket
    // is served via a Cloudflare R2 custom domain that bypasses the
    // worker — there's no place to inject a header on read. Keys
    // are content-hashed, so `immutable` is safe forever; a
    // replacement upload produces a new key.
    httpMetadata: {
      contentType: "application/pdf",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

export async function deleteGazettePdf(key: string): Promise<void> {
  await getPublicBucket().delete(key);
}

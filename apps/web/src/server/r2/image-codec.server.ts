/**
 * Shared image helpers for any feature that uploads a content-hashed
 * blob to R2. Lives here (not under a specific feature folder) so the
 * landing and gear features — which can't import each other per the
 * `import/no-restricted-paths` rule — can both depend on it.
 *
 * What's here:
 *   - `decodeImageDataUrl` — parses a `data:image/...` URL, validates
 *     the declared content type against magic bytes, and returns raw
 *     bytes. Useful for any base64-data-URL upload path.
 *   - `shortContentHash` — first 8 bytes of SHA-256 as a hex string,
 *     used to build immutable R2 keys. 64 bits of collision resistance
 *     is plenty for tens of thousands of small images.
 */
export type AcceptedImageContentType =
  | "image/webp"
  | "image/jpeg"
  | "image/png";

const DATA_URL_RE =
  /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+=*)$/;

export function decodeImageDataUrl(
  dataUrl: string,
  maxBytes: number,
): {
  contentType: AcceptedImageContentType;
  bytes: ArrayBuffer;
} {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("Image data URL is not a recognized type");
  }
  const contentType = match[1] as AcceptedImageContentType;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Image exceeds ${maxBytes} bytes (got ${bytes.byteLength})`,
    );
  }
  if (!matchesMagic(bytes, contentType)) {
    throw new Error("Image bytes do not match declared content type");
  }
  return { contentType, bytes: bytes.buffer };
}

function matchesMagic(
  bytes: Uint8Array,
  contentType: AcceptedImageContentType,
) {
  if (contentType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (contentType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export async function shortContentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

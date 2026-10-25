/**
 * Decode an image sent to a server fn as a `data:` URL.
 *
 * Uploads arrive this way rather than as FormData because every server
 * fn validates JSON via zod, and the client already holds a base64
 * string from the canvas export. Shared by avatar uploads and
 * site-feedback screenshots, which differ only in the types they allow
 * and their size cap.
 */
export type ImageContentType = "image/webp" | "image/jpeg" | "image/png";

const DATA_URL_RE = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+=*)$/;

export function decodeImageDataUrl(
  dataUrl: string,
  opts: { allowed: readonly ImageContentType[]; maxBytes: number },
): { contentType: ImageContentType; bytes: ArrayBuffer } {
  const match = DATA_URL_RE.exec(dataUrl);
  const contentType = opts.allowed.find((allowed) => allowed === match?.[1]);
  if (!match || contentType === undefined) {
    throw new Error("Image data URL is not an allowed image type");
  }
  // Reject on the encoded length first, so an oversized payload is never
  // decoded into memory at all: base64 carries 3 bytes per 4 characters.
  if (Math.floor((match[2].length * 3) / 4) > opts.maxBytes + 2) {
    throw new Error(`Image exceeds ${opts.maxBytes} bytes`);
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > opts.maxBytes) {
    throw new Error(
      `Image exceeds ${opts.maxBytes} bytes (got ${bytes.byteLength})`,
    );
  }
  // Magic-byte check: an attacker who skips the client could lie in
  // the Content-Type prefix, so verify the actual bytes match.
  if (!matchesMagic(bytes, contentType)) {
    throw new Error("Image bytes do not match declared content type");
  }
  return { contentType, bytes: bytes.buffer };
}

function matchesMagic(bytes: Uint8Array, contentType: ImageContentType) {
  if (contentType === "image/webp") {
    // RIFF....WEBP
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
  // PNG: 89 50 4E 47 0D 0A 1A 0A
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

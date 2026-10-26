import { getImages } from "#/server/images";

/** More chunks than any WebP the binding writes; a longer walk is refused. */
const MAX_WEBP_CHUNKS = 64;
/** The RIFF chunks that carry metadata: EXIF (with GPS) and XMP. */
const METADATA_CHUNKS = new Set(["EXIF", "XMP "]);

function fourcc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/**
 * Walks the rendered WebP's RIFF chunks and throws on a metadata chunk,
 * or on anything it can't walk to the end: a missing RIFF/WEBP header, a
 * chunk running past the end (the DataView read throws), or more chunks
 * than `MAX_WEBP_CHUNKS`. Fail closed, because the binding's "WebP has
 * no metadata" was only ever probed with JPEG input.
 */
function assertNoMetadataChunks(bytes: ArrayBuffer): void {
  const view = new DataView(bytes);
  if (fourcc(view, 0) !== "RIFF" || fourcc(view, 8) !== "WEBP") {
    throw new Error("Images binding output is not a RIFF WebP");
  }
  const walk = (at: number, step: number): void => {
    if (at === bytes.byteLength) {
      return;
    }
    if (step >= MAX_WEBP_CHUNKS) {
      throw new Error("Images binding output has too many chunks");
    }
    const type = fourcc(view, at);
    const length = view.getUint32(at + 4, true);
    if (METADATA_CHUNKS.has(type)) {
      throw new Error(`Images binding output carries a ${type.trim()} chunk`);
    }
    // Chunks are padded to an even length.
    const next = at + 8 + length + (length % 2);
    if (next > bytes.byteLength) {
      throw new RangeError("Images binding output chunk runs past the end");
    }
    walk(next, step + 1);
  };
  walk(12, 0);
}

/**
 * Re-encodes an uploaded original as a WebP carrying no metadata.
 *
 * Throws on any binding failure (quota error 9422, unreadable input, ...),
 * and when the output carries an `EXIF` or `XMP ` chunk after all; the
 * caller decides what that means for the upload (no `full_key`, so the
 * full-size route answers 404 rather than serving it).
 */
export async function renderCleanWebp(
  original: ArrayBuffer,
): Promise<{ bytes: ArrayBuffer; widthPx: number; heightPx: number }> {
  const result = await getImages()
    .input(new Response(original).body as ReadableStream<Uint8Array>)
    .output({
      // WebP ON PURPOSE. Through the binding, WebP output carries no
      // metadata at all, but JPEG output KEEPS the GPS IFD, capture time
      // and camera make, and `ImageOutputOptions` has no way to ask
      // otherwise. "Serve a JPEG for compatibility" would publish members'
      // locations. See "The JPEG trap" in
      // docs/superpowers/2026-10-25-album-originals/design.md.
      format: "image/webp",
      quality: 90,
    });
  const bytes = await result.response().arrayBuffer();

  // `.info()` is free and reports what was really produced.
  const info = await getImages().info(
    new Response(bytes).body as ReadableStream<Uint8Array>,
  );
  if (info.format !== "image/webp" || !("width" in info)) {
    throw new Error(
      `Images binding returned ${info.format}, expected image/webp`,
    );
  }
  assertNoMetadataChunks(bytes);
  return { bytes, widthPx: info.width, heightPx: info.height };
}

/**
 * Reads the calendar date a photo was taken from its EXIF block.
 *
 * A small read-only parser of our own (`exifr` is unmaintained). It reads
 * one thing, the capture date, and nothing else: no GPS, camera fields or
 * offset. The value is the date the camera showed, with no time-zone
 * conversion. See the "Photo date" section of
 * docs/superpowers/2026-10-25-album-originals/design.md.
 *
 * Pure (Temporal only, no `cloudflare:workers`), so it is mutation-tested.
 *
 * The input is hostile: every read is bounds-checked (a bad one throws),
 * container walks and IFD entry counts are capped, an IFD is never re-read
 * through its own pointer, and any failure returns `null` rather than
 * throwing.
 */

const MAX_STEPS = 64;
const MAX_IFD_ENTRIES = 512;
/** "YYYY:MM:DD HH:MM:SS" is 19 characters; the parser needs the first 10. */
const MAX_DATE_CHARS = 19;

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;

const EXIF_HEADER = "Exif\0\0";

/** A view of the bytes whose getters throw on any out-of-range read. */
function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Throws unless `length` bytes starting at `start` are all inside `bytes`. */
function sliceChecked(
  bytes: Uint8Array,
  start: number,
  length: number,
): Uint8Array {
  if (start + length > bytes.length) {
    throw new RangeError("read past end");
  }
  return bytes.subarray(start, start + length);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...sliceChecked(bytes, start, length));
}

function hasPrefix(bytes: Uint8Array, at: number, text: string): boolean {
  return ascii(bytes, at, text.length) === text;
}

/**
 * Runs `visit` on each container position, starting at `start`, until it
 * returns a result (a found block, or `null` for "stop, nothing here") or
 * `MAX_STEPS` positions have been visited. `visit` returns the next
 * position as `{ next }` to keep walking.
 */
function walk(
  start: number,
  visit: (at: number) => Uint8Array | null | { next: number },
): Uint8Array | null {
  const step = (at: number, count: number): Uint8Array | null => {
    if (count >= MAX_STEPS) {
      return null;
    }
    const result = visit(at);
    return result !== null && "next" in result
      ? step(result.next, count + 1)
      : result;
  };
  return step(start, 0);
}

/** Walks a JPEG's segments to the `APP1` that starts `Exif\0\0`. */
function findTiffInJpeg(bytes: Uint8Array): Uint8Array | null {
  const view = viewOf(bytes);
  return walk(2, (at) => {
    if (bytes[at] !== 0xff) {
      return null;
    }
    const marker = view.getUint8(at + 1);
    // Start of scan or end of image: no metadata segments follow.
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }
    const length = view.getUint16(at + 2);
    if (length < 2) {
      return null;
    }
    if (marker === 0xe1 && hasPrefix(bytes, at + 4, EXIF_HEADER)) {
      return sliceChecked(
        bytes,
        at + 4 + EXIF_HEADER.length,
        length - 2 - EXIF_HEADER.length,
      );
    }
    return { next: at + 2 + length };
  });
}

/** Walks a PNG's chunks to `eXIf`, which is the TIFF block itself. */
function findTiffInPng(bytes: Uint8Array): Uint8Array | null {
  const view = viewOf(bytes);
  return walk(8, (at) => {
    const length = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    if (type === "eXIf") {
      return sliceChecked(bytes, at + 8, length);
    }
    if (type === "IEND") {
      return null;
    }
    return { next: at + 12 + length };
  });
}

/** Walks a WebP's RIFF chunks to `EXIF`, which some writers prefix with `Exif\0\0`. */
function findTiffInWebp(bytes: Uint8Array): Uint8Array | null {
  const view = viewOf(bytes);
  return walk(12, (at) => {
    const type = ascii(bytes, at, 4);
    const length = view.getUint32(at + 4, true);
    if (type === "EXIF") {
      const body = sliceChecked(bytes, at + 8, length);
      return hasPrefix(body, 0, EXIF_HEADER)
        ? body.subarray(EXIF_HEADER.length)
        : body;
    }
    // Chunks are padded to an even length.
    return { next: at + 8 + length + (length % 2) };
  });
}

function findTiff(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return findTiffInJpeg(bytes);
  }
  if (hasPrefix(bytes, 0, "\x89PNG\r\n\x1a\n")) {
    return findTiffInPng(bytes);
  }
  if (hasPrefix(bytes, 0, "RIFF") && hasPrefix(bytes, 8, "WEBP")) {
    return findTiffInWebp(bytes);
  }
  return null;
}

/** Looks up one ASCII tag in the IFD at `offset`; also reports the Exif IFD pointer. */
function readIfd(
  tiff: Uint8Array,
  offset: number,
  little: boolean,
  wanted: number,
): { value: string | null; exifIfd: number | null } {
  const view = viewOf(tiff);
  const count = view.getUint16(offset, little);
  if (count > MAX_IFD_ENTRIES) {
    throw new RangeError("too many IFD entries");
  }
  const entries = Array.from({ length: count }, (_, i) => offset + 2 + i * 12);
  // A later entry with the same tag wins, as a plain overwrite would.
  return entries.reduce<{ value: string | null; exifIfd: number | null }>(
    (found, entry) => {
      const tag = view.getUint16(entry, little);
      if (tag === wanted) {
        const length = view.getUint32(entry + 4, little);
        // A date string is 20 bytes, so it is always stored out of line.
        // The whole declared count must be in bounds, but only the leading
        // characters are read: a hostile count must not cost CPU.
        const raw = sliceChecked(
          tiff,
          view.getUint32(entry + 8, little),
          length,
        );
        return {
          ...found,
          value: String.fromCharCode(...raw.subarray(0, MAX_DATE_CHARS)),
        };
      }
      if (tag === TAG_EXIF_IFD_POINTER) {
        return { ...found, exifIfd: view.getUint32(entry + 8, little) };
      }
      return found;
    },
    { value: null, exifIfd: null },
  );
}

function parseDate(value: string): Temporal.PlainDate | null {
  // No match leaves every part undefined, so NaN, which Temporal rejects.
  const [, year, month, day] = /^(\d{4}):(\d{2}):(\d{2})/.exec(value) ?? [];
  try {
    return Temporal.PlainDate.from(
      { year: Number(year), month: Number(month), day: Number(day) },
      { overflow: "reject" },
    );
  } catch {
    return null;
  }
}

/**
 * The capture date, or null when there is no EXIF, no usable date, or the
 * input is malformed. A present but unusable DateTimeOriginal (camera
 * placeholder, impossible date) yields null rather than falling back to
 * DateTime, which is the file's modification time.
 */
export function readExifCaptureDate(
  bytes: Uint8Array,
): Temporal.PlainDate | null {
  try {
    const tiff = findTiff(bytes);
    if (tiff === null) {
      return null;
    }
    const order = ascii(tiff, 0, 2);
    if (order !== "II" && order !== "MM") {
      return null;
    }
    const little = order === "II";
    const ifd0Offset = viewOf(tiff).getUint32(4, little);
    const ifd0 = readIfd(tiff, ifd0Offset, little, TAG_DATE_TIME);

    // Only one pointer is ever followed, so the one loop a hostile file can
    // build is the Exif pointer naming IFD0 itself: refuse it.
    if (ifd0.exifIfd !== null && ifd0.exifIfd !== ifd0Offset) {
      const exif = readIfd(tiff, ifd0.exifIfd, little, TAG_DATE_TIME_ORIGINAL);
      if (exif.value !== null) {
        return parseDate(exif.value);
      }
    }
    return ifd0.value === null ? null : parseDate(ifd0.value);
  } catch {
    return null;
  }
}

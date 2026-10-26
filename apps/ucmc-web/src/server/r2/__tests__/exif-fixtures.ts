/**
 * Byte builders for EXIF tests: a TIFF block and the JPEG / PNG / WebP
 * containers that carry one. Pure (no `cloudflare:workers`), so the
 * mutation project can load them too. No checked-in binary fixtures.
 */

export interface TiffOptions {
  order: "II" | "MM";
  /** An empty object still writes an (empty) Exif IFD. */
  exif?: { DateTimeOriginal?: string };
  /** `DateTimeOriginal` in IFD0 is not valid EXIF: it exists to prove a looping pointer is ignored. */
  ifd0?: { DateTime?: string; DateTimeOriginal?: string };
  /** Overrides the ExifIFDPointer value (a hostile offset). */
  exifPointer?: number;
  /** Adds a bogus extra entry to IFD0 so entry walks are exercised. */
  extraIfd0Entries?: number;
  /** Declares this count for IFD0 DateTime instead of the string length. */
  dateTimeCount?: number;
  /** Zero bytes appended to the block, so a huge declared count stays in bounds. */
  padding?: number;
}

const ASCII = 2;
const LONG = 4;

function ascii(value: string): number[] {
  return [...value].map((c) => c.charCodeAt(0)).concat(0);
}

/** Builds a TIFF block whose IFD0 holds the requested tags. */
export function tiff(options: TiffOptions): Uint8Array {
  const little = options.order === "II";
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
      : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const entry = (tag: number, type: number, count: number, value: number) => [
    ...u16(tag),
    ...u16(type),
    ...u32(count),
    ...u32(value),
  ];

  const dateTime = options.ifd0?.DateTime;
  const original = options.exif?.DateTimeOriginal;
  const ifd0Original = options.ifd0?.DateTimeOriginal;
  const hasExifIfd =
    options.exif !== undefined || options.exifPointer !== undefined;
  const extra = options.extraIfd0Entries ?? 0;
  const ifd0Count =
    (dateTime === undefined ? 0 : 1) +
    (hasExifIfd ? 1 : 0) +
    (ifd0Original === undefined ? 0 : 1) +
    extra;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const exifIfdSize =
    options.exif === undefined ? 0 : 2 + (original === undefined ? 0 : 12) + 4;
  const dataOffset = exifIfdOffset + exifIfdSize;

  const data: number[] = [];
  const place = (value: string): number => {
    const at = dataOffset + data.length;
    data.push(...ascii(value));
    return at;
  };

  const ifd0: number[] = [...u16(ifd0Count)];
  // Tags must be ascending: 0x0132 before 0x8769.
  if (dateTime !== undefined) {
    ifd0.push(
      ...entry(
        0x0132,
        ASCII,
        options.dateTimeCount ?? dateTime.length + 1,
        place(dateTime),
      ),
    );
  }
  if (hasExifIfd) {
    ifd0.push(...entry(0x8769, LONG, 1, options.exifPointer ?? exifIfdOffset));
  }
  if (ifd0Original !== undefined) {
    ifd0.push(
      ...entry(0x9003, ASCII, ifd0Original.length + 1, place(ifd0Original)),
    );
  }
  for (let i = 0; i < extra; i += 1) {
    ifd0.push(...entry(0x0100, LONG, 1, 0));
  }
  ifd0.push(...u32(0));

  const exifIfd: number[] = [];
  if (options.exif !== undefined) {
    exifIfd.push(
      ...(original === undefined
        ? [...u16(0)]
        : [
            ...u16(1),
            ...entry(0x9003, ASCII, original.length + 1, place(original)),
          ]),
      ...u32(0),
    );
  }

  return Uint8Array.from([
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...ifd0,
    ...exifIfd,
    ...data,
    ...new Array<number>(options.padding ?? 0).fill(0),
  ]);
}

export const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [
  (n >>> 24) & 255,
  (n >> 16) & 255,
  (n >> 8) & 255,
  n & 255,
];
const le32 = (n: number) => [
  n & 255,
  (n >> 8) & 255,
  (n >> 16) & 255,
  (n >>> 24) & 255,
];

/** One JPEG segment: marker, big-endian length (which counts itself), body. */
export function jpegSegment(marker: number, body: number[]): number[] {
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 255, ...body];
}

/** An `APP1` segment carrying `Exif\0\0` and the TIFF block. */
export function app1Segment(tiffBytes: Uint8Array): number[] {
  return jpegSegment(0xe1, [...text("Exif"), 0, 0, ...tiffBytes]);
}

/** SOI, the given segments, EOI. */
export function jpegOf(...segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);
}

/** SOI, a filler APP0, the Exif APP1, EOI. */
export function jpegWithApp1(tiffBytes: Uint8Array): Uint8Array {
  return jpegOf(jpegSegment(0xe0, [0, 0]), app1Segment(tiffBytes));
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG chunk. The CRC is zero: the reader ignores it. */
export function pngChunk(type: string, body: number[]): number[] {
  return [...be32(body.length), ...text(type), ...body, 0, 0, 0, 0];
}

export function pngOf(...chunks: number[][]): Uint8Array {
  return Uint8Array.from([...PNG_SIGNATURE, ...chunks.flat()]);
}

/** PNG signature, a filler chunk, eXIf chunk, IEND. */
export function pngWithExif(tiffBytes: Uint8Array): Uint8Array {
  return pngOf(
    pngChunk("tEXt", text("k\0v")),
    pngChunk("eXIf", [...tiffBytes]),
    pngChunk("IEND", []),
  );
}

/** A RIFF chunk, padded to an even length. */
export function webpChunk(type: string, body: number[]): number[] {
  return [
    ...text(type),
    ...le32(body.length),
    ...body,
    ...(body.length % 2 === 1 ? [0] : []),
  ];
}

export function webpOf(...chunks: number[][]): Uint8Array {
  const body = [...text("WEBP"), ...chunks.flat()];
  return Uint8Array.from([...text("RIFF"), ...le32(body.length), ...body]);
}

/** RIFF/WEBP with a filler odd-sized chunk (padded) then the EXIF chunk. */
export function webpWithExif(
  tiffBytes: Uint8Array,
  options: { exifPrefix?: boolean } = {},
): Uint8Array {
  const prefix = options.exifPrefix ? [...text("Exif"), 0, 0] : [];
  return webpOf(
    webpChunk("VP8X", [1, 2, 3]),
    webpChunk("EXIF", [...prefix, ...tiffBytes]),
  );
}

import { describe, expect, it } from "vitest";

import { readExifCaptureDate } from "../exif-date.server";
import {
  app1Segment,
  jpegOf,
  jpegSegment,
  jpegWithApp1,
  pngChunk,
  pngOf,
  pngWithExif,
  text,
  tiff,
  webpChunk,
  webpOf,
  webpWithExif,
} from "./exif-fixtures";

/** The date as `YYYY-MM-DD`, or exactly `null` (not `undefined`). */
const read = (bytes: Uint8Array): string | null => {
  const date = readExifCaptureDate(bytes);
  return date === null ? null : date.toString();
};

const ORIGINAL = { DateTimeOriginal: "2024:09:14 15:42:07" };
const goodTiff = (order: "II" | "MM" = "II") => tiff({ order, exif: ORIGINAL });

describe("readExifCaptureDate", () => {
  describe("containers and byte orders", () => {
    it("reads DateTimeOriginal from a little-endian JPEG", () => {
      expect(read(jpegWithApp1(goodTiff("II")))).toBe("2024-09-14");
    });

    it("reads DateTimeOriginal from a big-endian JPEG", () => {
      expect(read(jpegWithApp1(goodTiff("MM")))).toBe("2024-09-14");
    });

    it("reads the PNG eXIf chunk", () => {
      expect(
        read(
          pngWithExif(
            tiff({
              order: "MM",
              exif: { DateTimeOriginal: "2023:06:01 08:00:00" },
            }),
          ),
        ),
      ).toBe("2023-06-01");
    });

    it("reads the WebP EXIF chunk, with or without an Exif prefix", () => {
      const t = tiff({
        order: "II",
        exif: { DateTimeOriginal: "2022:12:31 23:59:59" },
      });
      expect(read(webpWithExif(t))).toBe("2022-12-31");
      expect(read(webpWithExif(t, { exifPrefix: true }))).toBe("2022-12-31");
    });

    it("rejects a TIFF block whose byte-order mark is neither II nor MM", () => {
      const t = goodTiff("MM");
      t.set(text("XX"), 0);
      expect(read(jpegWithApp1(t))).toBeNull();
    });
  });

  describe("which tag wins", () => {
    it("falls back to IFD0 DateTime", () => {
      expect(
        read(
          jpegWithApp1(
            tiff({ order: "II", ifd0: { DateTime: "2021:03:04 05:06:07" } }),
          ),
        ),
      ).toBe("2021-03-04");
    });

    it("falls back to IFD0 DateTime when the Exif IFD has no DateTimeOriginal", () => {
      expect(
        read(
          jpegWithApp1(
            tiff({
              order: "MM",
              exif: {},
              ifd0: { DateTime: "2021:03:04 05:06:07" },
            }),
          ),
        ),
      ).toBe("2021-03-04");
    });

    it("prefers DateTimeOriginal over DateTime", () => {
      const t = tiff({
        order: "MM",
        exif: { DateTimeOriginal: "2020:01:02 00:00:00" },
        ifd0: { DateTime: "2021:03:04 05:06:07" },
      });
      expect(read(jpegWithApp1(t))).toBe("2020-01-02");
    });

    it("ignores other IFD0 tags, whatever they point at", () => {
      expect(
        read(
          jpegWithApp1(
            tiff({ order: "II", exif: ORIGINAL, extraIfd0Entries: 2 }),
          ),
        ),
      ).toBe("2024-09-14");
    });

    it("does not substitute DateTime for a placeholder DateTimeOriginal", () => {
      const t = tiff({
        order: "II",
        exif: { DateTimeOriginal: "0000:00:00 00:00:00" },
        ifd0: { DateTime: "2021:03:04 05:06:07" },
      });
      expect(read(jpegWithApp1(t))).toBeNull();
    });
  });

  describe("no usable date", () => {
    it("returns null when there is no EXIF", () => {
      expect(read(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
      expect(read(pngOf(pngChunk("IEND", [])))).toBeNull();
      expect(read(webpOf())).toBeNull();
      expect(read(new Uint8Array())).toBeNull();
      expect(
        read(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
      ).toBeNull();
    });

    it("returns null for a TIFF with no date tags", () => {
      expect(read(jpegWithApp1(tiff({ order: "II" })))).toBeNull();
      expect(read(jpegWithApp1(tiff({ order: "MM", exif: {} })))).toBeNull();
    });

    it("returns null for placeholder and impossible dates", () => {
      for (const bad of [
        "0000:00:00 00:00:00",
        "                   ",
        "2024:02:30 00:00:00",
        "2024:13:01 00:00:00",
        "x2024:09:14 00:00:00",
        "2024-09-14 00:00:00",
      ]) {
        expect(
          read(
            jpegWithApp1(
              tiff({ order: "II", exif: { DateTimeOriginal: bad } }),
            ),
          ),
        ).toBeNull();
      }
    });
  });

  describe("JPEG walking", () => {
    const exifSegment = app1Segment(goodTiff());
    const filler = jpegSegment(0xe0, [0, 0]);

    it("skips an APP1 that is not Exif (XMP) and finds the one after it", () => {
      const xmp = jpegSegment(0xe1, text("http://ns.adobe.com/xap/1.0/\0"));
      expect(read(jpegOf(xmp, exifSegment))).toBe("2024-09-14");
    });

    it("ignores an Exif header under any marker but APP1", () => {
      const notApp1 = jpegSegment(0xe2, [...text("Exif"), 0, 0, ...goodTiff()]);
      expect(read(jpegOf(notApp1))).toBeNull();
    });

    it("stops at start-of-scan and end-of-image markers", () => {
      expect(read(jpegOf(jpegSegment(0xda, []), exifSegment))).toBeNull();
      expect(read(jpegOf([0xff, 0xd9, 0x00, 0x02], exifSegment))).toBeNull();
    });

    it("accepts a segment with the minimum length of 2", () => {
      expect(read(jpegOf(jpegSegment(0xe0, []), exifSegment))).toBe(
        "2024-09-14",
      );
    });

    it("stops at a segment with a length below 2", () => {
      expect(read(jpegOf([0xff, 0xe0, 0x00, 0x00], exifSegment))).toBeNull();
    });

    it("stops when the next byte is not a marker prefix", () => {
      // Read as a segment from offset 2, these bytes would be a valid Exif APP1.
      const asSegment = exifSegment.slice(1);
      expect(
        read(Uint8Array.from([0xff, 0xd8, 0x00, ...asSegment])),
      ).toBeNull();
    });

    it("needs both bytes of the SOI", () => {
      expect(read(Uint8Array.from([0x00, 0xd8, ...exifSegment]))).toBeNull();
      expect(read(Uint8Array.from([0xff, 0x00, ...exifSegment]))).toBeNull();
    });

    it("gives up after 64 segments, but not before", () => {
      const fillers = (n: number) => Array.from({ length: n }, () => filler);
      expect(read(jpegOf(...fillers(63), exifSegment))).toBe("2024-09-14");
      expect(read(jpegOf(...fillers(64), exifSegment))).toBeNull();
      expect(read(jpegOf(...fillers(200), exifSegment))).toBeNull();
    });

    it("returns null when the APP1 length runs past the end", () => {
      const bytes = jpegWithApp1(goodTiff());
      // Overstate the APP1 length: the last real byte is no longer the end.
      const at = bytes.indexOf(0xe1) + 1;
      bytes[at] = 0xff;
      expect(read(bytes)).toBeNull();
    });
  });

  describe("PNG walking", () => {
    const exifChunk = pngChunk("eXIf", [...goodTiff()]);
    const filler = pngChunk("tEXt", text("k\0v"));

    it("stops at IEND", () => {
      expect(read(pngOf(pngChunk("IEND", []), exifChunk))).toBeNull();
    });

    it("gives up after 64 chunks, but not before", () => {
      const fillers = (n: number) => Array.from({ length: n }, () => filler);
      expect(read(pngOf(...fillers(63), exifChunk))).toBe("2024-09-14");
      expect(read(pngOf(...fillers(64), exifChunk))).toBeNull();
      expect(read(pngOf(...fillers(200), exifChunk))).toBeNull();
    });

    it("returns null when the eXIf length runs past the end", () => {
      const bytes = pngOf(exifChunk);
      const at = bytes.length - exifChunk.length;
      bytes[at + 3] = 0xff; // length low byte
      expect(read(bytes)).toBeNull();
    });
  });

  describe("WebP walking", () => {
    const exifChunk = webpChunk("EXIF", [...goodTiff()]);
    const filler = webpChunk("JUNK", [1, 2]);

    it("needs both RIFF and WEBP", () => {
      const notRiff = webpOf(exifChunk);
      notRiff.set(text("RIFX"), 0);
      expect(read(notRiff)).toBeNull();
      const notWebp = webpOf(exifChunk);
      notWebp.set(text("WAVE"), 8);
      expect(read(notWebp)).toBeNull();
    });

    it("gives up after 64 chunks, but not before", () => {
      const fillers = (n: number) => Array.from({ length: n }, () => filler);
      expect(read(webpOf(...fillers(63), exifChunk))).toBe("2024-09-14");
      expect(read(webpOf(...fillers(64), exifChunk))).toBeNull();
      expect(read(webpOf(...fillers(200), exifChunk))).toBeNull();
    });

    it("returns null when the EXIF length runs past the end", () => {
      const bytes = webpOf(exifChunk);
      const at = bytes.length - exifChunk.length;
      bytes[at + 4] = 0xff; // length low byte, little-endian
      expect(read(bytes)).toBeNull();
    });
  });

  describe("hostile TIFF", () => {
    it("returns the date or null for every truncation, null while the TIFF block is cut", () => {
      const indexOfBlock = (haystack: Uint8Array, needle: Uint8Array) => {
        for (let i = 0; i + needle.length <= haystack.length; i += 1) {
          if (needle.every((byte, j) => haystack[i + j] === byte)) {
            return i;
          }
        }
        throw new Error("block not found");
      };
      for (const make of [jpegWithApp1, pngWithExif, webpWithExif]) {
        for (const order of ["II", "MM"] as const) {
          const block = tiff({
            order,
            exif: ORIGINAL,
            ifd0: { DateTime: "2021:03:04 05:06:07" },
          });
          const full = make(block);
          const blockEnd = indexOfBlock(full, block) + block.length;
          expect(read(full)).toBe("2024-09-14");
          const results = Array.from({ length: full.length }, (_, n) =>
            read(full.subarray(0, n)),
          );
          for (const result of results) {
            expect([null, "2024-09-14"]).toContain(result);
          }
          // Cut anywhere inside the TIFF block: the date must not come back.
          expect(results.slice(0, blockEnd).every((r) => r === null)).toBe(
            true,
          );
        }
      }
    });

    it("reads only the leading characters of a huge in-bounds count", () => {
      // 2M declared bytes, all in bounds (PNG: a JPEG segment tops out at 64 KB): the date still reads (contract:
      // in-bounds count => the leading date is used), and cheaply.
      const t = tiff({
        order: "II",
        ifd0: { DateTime: "2021:03:04 05:06:07" },
        dateTimeCount: 2_000_000,
        padding: 2_000_000,
      });
      expect(read(pngWithExif(t))).toBe("2021-03-04");
    });

    it("returns null when an offset points past the end", () => {
      for (const order of ["II", "MM"] as const) {
        const t = tiff({ order, exif: ORIGINAL, exifPointer: 0xffffff00 });
        expect(read(jpegWithApp1(t))).toBeNull();
      }
    });

    it("returns null when a date string is one byte short of its length", () => {
      const t = tiff({ order: "II", ifd0: { DateTime: "2024:09:14" } });
      // The string is stored last, with its NUL; cut the NUL off.
      expect(read(pngOf(pngChunk("eXIf", [...t])))).toBe("2024-09-14");
      expect(
        read(pngOf(pngChunk("eXIf", [...t.subarray(0, t.length - 1)]))),
      ).toBeNull();
    });

    it("ignores an Exif pointer that names IFD0 itself", () => {
      const t = tiff({
        order: "II",
        exifPointer: 8,
        ifd0: {
          DateTime: "2021:03:04 05:06:07",
          DateTimeOriginal: "2019:01:01 00:00:00",
        },
      });
      expect(read(jpegWithApp1(t))).toBe("2021-03-04");
    });

    it("caps IFD entries at 512", () => {
      const withEntries = (n: number) =>
        tiff({
          order: "MM",
          ifd0: { DateTime: "2021:03:04 05:06:07" },
          extraIfd0Entries: n,
        });
      expect(read(jpegWithApp1(withEntries(511)))).toBe("2021-03-04"); // 512 in all
      expect(read(jpegWithApp1(withEntries(512)))).toBeNull(); // 513 in all
    });
  });
});

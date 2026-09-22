/**
 * Pins the three mobile-Safari behaviours `#/lib/image-upload` exists
 * for. Each one is a *silent* failure mode — nothing throws where the
 * bug is — so each is asserted directly rather than inferred from an
 * upload succeeding.
 *
 * In the `.tsx` (jsdom) pool despite having no JSX: canvas, `Blob` and
 * `FileReader` are all DOM, and the workers pool has none of them.
 */
import { describe, expect, it, vi } from "vitest";

import {
  clampWorkingDimension,
  encodeCanvasToDataUrl,
  IMAGE_UPLOAD_ACCEPT,
  ImageUploadError,
  imageUploadErrorMessage,
  MAX_CANVAS_AREA,
  normalizeImageFile,
} from "#/lib/image-upload";

const compressMock = vi.hoisted(() => vi.fn());
vi.mock("browser-image-compression", () => ({ default: compressMock }));

/**
 * A canvas whose `toBlob` reports the type we tell it to, which is the
 * part of the platform under test: per the HTML spec an unsupported
 * `type` does not fail, it encodes PNG and says so in `blob.type`.
 */
function fakeCanvas(type: string | null) {
  return {
    toBlob: (cb: (b: Blob | null) => void) => {
      cb(type === null ? null : new Blob(["x"], { type }));
    },
  } as unknown as HTMLCanvasElement;
}

describe("IMAGE_UPLOAD_ACCEPT", () => {
  it("enumerates types instead of using image/*", () => {
    // Not cosmetic. A generic `image/*` makes the iOS Photos picker hand
    // over the original HEIC; an explicit list that omits HEIC makes iOS
    // transcode to JPEG on selection. Nothing downstream can decode
    // HEIC, so `image/*` is the bug.
    expect(IMAGE_UPLOAD_ACCEPT).not.toContain("image/*");
    expect(IMAGE_UPLOAD_ACCEPT).toBe("image/png,image/jpeg,image/webp");
  });

  it("excludes HEIC and SVG", () => {
    // HEIC for the reason above; SVG because it is a script-execution
    // surface on pages anonymous visitors load.
    expect(IMAGE_UPLOAD_ACCEPT).not.toContain("heic");
    expect(IMAGE_UPLOAD_ACCEPT).not.toContain("heif");
    expect(IMAGE_UPLOAD_ACCEPT).not.toContain("svg");
  });
});

describe("encodeCanvasToDataUrl", () => {
  it("rejects a PNG the browser substituted for WebP", async () => {
    // The silent fallback is the whole point: unchecked, these bytes
    // travel to a server that accepts only `data:image/webp` and the
    // member is shown a validator message about data-URL shapes.
    await expect(
      encodeCanvasToDataUrl(fakeCanvas("image/png"), 0.85),
    ).rejects.toThrow(ImageUploadError);
  });

  it("encodes when the browser really produced WebP", async () => {
    await expect(
      encodeCanvasToDataUrl(fakeCanvas("image/webp"), 0.85),
    ).resolves.toMatch(/^data:image\/webp;base64,/);
  });

  it("reports a null blob as a member-facing error", async () => {
    await expect(encodeCanvasToDataUrl(fakeCanvas(null), 0.85)).rejects.toThrow(
      ImageUploadError,
    );
  });
});

describe("clampWorkingDimension", () => {
  it("keeps a square working canvas inside the platform area cap", () => {
    // iOS Safari doesn't throw past its canvas-area cap — `drawImage`
    // paints nothing — so an unclamped dimension yields a blank upload
    // rather than an error anyone can act on.
    const clamped = clampWorkingDimension(2400);

    expect(clamped * clamped).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(clamped).toBeLessThan(2400);
  });

  it("never scales a smaller request up", () => {
    expect(clampWorkingDimension(256)).toBe(256);
  });
});

describe("normalizeImageFile", () => {
  const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

  it("retries on the main thread when the worker decode fails", async () => {
    // The worker path is the one that fails on mobile Safari, and it
    // fails with a worker-internal rejection carrying no useful message.
    // Without this retry that is the end of the upload.
    const out = new Blob(["ok"], { type: "image/jpeg" });
    compressMock.mockReset();
    compressMock
      .mockRejectedValueOnce(new Error("worker blew up"))
      .mockResolvedValueOnce(out);

    await expect(
      normalizeImageFile(file, { maxDimension: 1600 }),
    ).resolves.toBe(out);

    expect(compressMock.mock.calls[0]?.[1]).toMatchObject({
      useWebWorker: true,
    });
    expect(compressMock.mock.calls[1]?.[1]).toMatchObject({
      useWebWorker: false,
    });
  });

  it("gives up with a member-facing message when both attempts fail", async () => {
    compressMock.mockReset();
    compressMock.mockRejectedValue(
      new Error("t.getImageData is not a function"),
    );

    const err = await normalizeImageFile(file, {
      maxDimension: 1600,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ImageUploadError);
    // The library's own message must not reach the member — that is the
    // "weird error" this module was written to stop.
    expect((err as Error).message).not.toContain("getImageData");
  });

  it("rejects an oversized source before decoding it", async () => {
    compressMock.mockReset();
    // A decoded bitmap costs ~4 bytes per pixel, so the guard has to
    // come before the decode, not after it.
    const huge = new File([], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });

    await expect(
      normalizeImageFile(huge, { maxDimension: 1600 }),
    ).rejects.toThrow(ImageUploadError);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it("clamps the requested working dimension it passes through", async () => {
    compressMock.mockReset();
    compressMock.mockResolvedValue(new Blob(["ok"], { type: "image/jpeg" }));

    await normalizeImageFile(file, { maxDimension: 2400 });

    const passed = compressMock.mock.calls[0]?.[1] as {
      maxWidthOrHeight: number;
    };
    expect(passed.maxWidthOrHeight).toBe(clampWorkingDimension(2400));
  });
});

describe("imageUploadErrorMessage", () => {
  it("passes an ImageUploadError's message through", () => {
    expect(
      imageUploadErrorMessage(new ImageUploadError("Pick a smaller one.")),
    ).toBe("Pick a smaller one.");
  });

  it("replaces anything else with a generic line", () => {
    // Callers render this straight into a toast, so an arbitrary error
    // reaching it is how internals leak to members.
    expect(
      imageUploadErrorMessage(new TypeError("e.i is undefined")),
    ).not.toContain("undefined");
  });
});

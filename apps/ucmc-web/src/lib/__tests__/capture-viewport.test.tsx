/**
 * `captureViewport` turns the visible page into an image small enough to
 * upload, or gives up with `null`. Giving up is a normal outcome (no
 * WebP encoder, a slow phone, an image the browser won't read back), and
 * the caller opens the dialog without a screenshot when it happens.
 *
 * `.tsx` only to land in the dom pool, which has a document;
 * `modern-screenshot` itself is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureViewport } from "#/lib/capture-viewport";

const ms = vi.hoisted(() => ({
  domToWebp: vi.fn<(node: Node, opts: unknown) => Promise<string>>(),
  domToJpeg: vi.fn<(node: Node, opts: unknown) => Promise<string>>(),
}));
vi.mock("modern-screenshot", () => ms);

/** A data URL whose decoded payload is exactly `bytes` long. */
function fakeDataUrl(type: string, bytes: number): string {
  return `data:${type};base64,${"A".repeat(Math.ceil(bytes / 3) * 4)}`;
}

describe("captureViewport", () => {
  beforeEach(() => {
    ms.domToWebp.mockReset();
    ms.domToJpeg.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns webp when the browser encodes webp", async () => {
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 3000));
    const shot = await captureViewport();
    expect(shot).toEqual({
      dataUrl: fakeDataUrl("image/webp", 3000),
      contentType: "image/webp",
      bytes: 3000,
    });
    expect(ms.domToJpeg).not.toHaveBeenCalled();
  });

  it("falls back to jpeg when the webp result is not image/webp", async () => {
    // Safari's canvas has no WebP encoder and hands back a PNG instead.
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/png", 3000));
    ms.domToJpeg.mockResolvedValue(fakeDataUrl("image/jpeg", 3000));
    const shot = await captureViewport();
    expect(shot?.contentType).toBe("image/jpeg");
    expect(ms.domToJpeg.mock.calls[0]?.[1]).toMatchObject({ quality: 0.8 });
  });

  it("retries jpeg at lower quality when over 1 048 576 bytes, then gives up with null", async () => {
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 1_100_000));
    ms.domToJpeg
      .mockResolvedValueOnce(fakeDataUrl("image/jpeg", 1_100_000))
      .mockResolvedValueOnce(fakeDataUrl("image/jpeg", 1_100_000));
    expect(await captureViewport()).toBeNull();
    expect(ms.domToJpeg.mock.calls.map((c) => c[1])).toMatchObject([
      { quality: 0.8 },
      { quality: 0.6 },
    ]);
  });

  it("uses the lower-quality jpeg when it fits", async () => {
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 1_100_000));
    ms.domToJpeg
      .mockResolvedValueOnce(fakeDataUrl("image/jpeg", 1_100_000))
      .mockResolvedValueOnce(fakeDataUrl("image/jpeg", 900_000));
    expect(await captureViewport()).toMatchObject({
      contentType: "image/jpeg",
      bytes: 900_000,
    });
  });

  it("captureViewport resolves null on timeout", async () => {
    vi.useFakeTimers();
    ms.domToWebp.mockReturnValue(new Promise(() => {}));
    const pending = captureViewport({ timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeNull();
  });

  it("resolves null when modern-screenshot throws", async () => {
    ms.domToWebp.mockRejectedValue(new Error("tainted canvas"));
    expect(await captureViewport()).toBeNull();
  });

  it("filters out Radix popper content and [data-feedback-capture-exclude]", async () => {
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 10));
    await captureViewport();
    const opts = ms.domToWebp.mock.calls[0]?.[1] as {
      filter: (node: Node) => boolean;
    };
    const popper = document.createElement("div");
    popper.setAttribute("data-radix-popper-content-wrapper", "");
    const excluded = document.createElement("div");
    excluded.setAttribute("data-feedback-capture-exclude", "");
    const ordinary = document.createElement("main");
    expect(opts.filter(popper)).toBe(false);
    expect(opts.filter(excluded)).toBe(false);
    expect(opts.filter(ordinary)).toBe(true);
    expect(opts.filter(document.createTextNode("hi"))).toBe(true);
  });

  it("fetches page images past every cache, and gives up on them within the timeout", async () => {
    // A cached response from a plain <img> carries no CORS header, and
    // the edge ignores Vary: Origin; a fresh URL per fetch avoids both.
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 10));
    await captureViewport({ timeoutMs: 3000 });
    const opts = ms.domToWebp.mock.calls[0]?.[1] as {
      timeout: number;
      fetch: { bypassingCache: boolean };
    };
    expect(opts.fetch.bypassingCache).toBe(true);
    expect(opts.timeout).toBeLessThanOrEqual(3000);
  });

  it("caps the output at 1600 px wide", async () => {
    ms.domToWebp.mockResolvedValue(fakeDataUrl("image/webp", 10));
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    await captureViewport({ maxWidth: 1600 });
    const opts = ms.domToWebp.mock.calls[0]?.[1] as {
      width: number;
      scale: number;
    };
    expect(opts.width).toBe(1280);
    expect(opts.width * opts.scale).toBe(1600);
  });

  describe("scrolled page", () => {
    function setScroll(x: number, y: number) {
      Object.defineProperty(window, "scrollX", {
        value: x,
        configurable: true,
      });
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    }

    afterEach(() => {
      setScroll(0, 0);
      document.body.innerHTML = "";
    });

    it("keeps fixed chrome where the member sees it, and cleans up", async () => {
      setScroll(0, 400);
      const header = document.createElement("header");
      header.style.position = "fixed";
      const inner = document.createElement("span");
      header.appendChild(inner);
      document.body.appendChild(header);
      let shifted = "";
      let innerShifted = "";
      ms.domToWebp.mockImplementation(async (_root, opts) => {
        const { onCloneEachNode, style } = opts as {
          onCloneEachNode: (n: Node) => void;
          style: { transform: string };
        };
        expect(style.transform).toBe("translate(0px, -400px)");
        const clone = header.cloneNode(true) as HTMLElement;
        onCloneEachNode(clone);
        onCloneEachNode(clone.firstChild as Node);
        shifted = clone.style.transform;
        innerShifted = (clone.firstChild as HTMLElement).style.transform;
        return fakeDataUrl("image/webp", 10);
      });
      await captureViewport();
      // The page is shifted up by the scroll; fixed chrome is shifted
      // back down so it stays where it was on screen. Its children ride
      // along and get no shift of their own.
      expect(shifted).toBe("translate(0px, 400px)");
      expect(innerShifted).toBe("");
      expect(header.hasAttribute("data-feedback-capture-shift")).toBe(false);
    });

    it("takes its marks off as soon as it times out", async () => {
      setScroll(0, 400);
      const header = document.createElement("header");
      header.style.position = "fixed";
      document.body.appendChild(header);
      ms.domToWebp.mockReturnValue(new Promise(() => {}));
      expect(await captureViewport({ timeoutMs: 20 })).toBeNull();
      expect(header.hasAttribute("data-feedback-capture-shift")).toBe(false);
    });

    it("an abandoned run finishing late doesn't strip a newer run's marks", async () => {
      setScroll(0, 400);
      const header = document.createElement("header");
      header.style.position = "fixed";
      document.body.appendChild(header);

      let finishFirst: (url: string) => void = () => {};
      ms.domToWebp.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          finishFirst = resolve;
        }),
      );
      expect(await captureViewport({ timeoutMs: 20 })).toBeNull();

      let shifted = "";
      ms.domToWebp.mockImplementationOnce(async (_root, opts) => {
        // The first run's encode settles while this one is cloning.
        finishFirst(fakeDataUrl("image/webp", 10));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const clone = header.cloneNode(true) as HTMLElement;
        (opts as { onCloneEachNode: (n: Node) => void }).onCloneEachNode(clone);
        shifted = clone.style.transform;
        return fakeDataUrl("image/webp", 10);
      });
      expect(await captureViewport()).not.toBeNull();
      expect(shifted).toBe("translate(0px, 400px)");
      expect(header.hasAttribute("data-feedback-capture-shift")).toBe(false);
    });

    it("shifts nothing at the top of the page", async () => {
      const header = document.createElement("header");
      header.style.position = "fixed";
      document.body.appendChild(header);
      ms.domToWebp.mockImplementation(async (_root, opts) => {
        expect((opts as { style?: unknown }).style).toBeUndefined();
        expect(header.hasAttribute("data-feedback-capture-shift")).toBe(false);
        return fakeDataUrl("image/webp", 10);
      });
      expect(await captureViewport()).not.toBeNull();
    });
  });
});

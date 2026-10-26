import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderCleanWebp } from "#/features/album/server/album-clean-copy.server";

const mocks = vi.hoisted(() => ({
  input: vi.fn(),
  output: vi.fn(),
  info: vi.fn(),
  response: vi.fn(),
}));

vi.mock("#/server/images", () => ({
  getImages: () => ({ input: mocks.input, info: mocks.info }),
}));

/** One RIFF chunk: fourcc, little-endian length, body, pad to even. */
function chunk(type: string, body: number[]): number[] {
  const length = body.length;
  return [
    ...Array.from(type, (c) => c.charCodeAt(0)),
    length & 0xff,
    (length >> 8) & 0xff,
    (length >> 16) & 0xff,
    (length >> 24) & 0xff,
    ...body,
    ...(length % 2 === 1 ? [0] : []),
  ];
}

function webp(...chunks: number[][]): ArrayBuffer {
  const body = [
    ...Array.from("WEBP", (c) => c.charCodeAt(0)),
    ...chunks.flat(),
  ];
  return new Uint8Array(chunk("RIFF", body)).buffer;
}

const PLAIN_WEBP = webp(chunk("VP8 ", [1, 2, 3]));

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

function outputs(bytes: ArrayBuffer): void {
  mocks.response.mockReturnValue(new Response(bytes));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.input.mockReturnValue({ output: mocks.output });
  mocks.output.mockResolvedValue({ response: mocks.response });
  outputs(PLAIN_WEBP);
  mocks.info.mockResolvedValue({
    format: "image/webp",
    fileSize: 4,
    width: 640,
    height: 480,
  });
});

describe("renderCleanWebp", () => {
  it("asks the binding for image/webp at quality 90", async () => {
    await renderCleanWebp(new Uint8Array([9, 9]).buffer);

    expect(mocks.output).toHaveBeenCalledExactlyOnceWith({
      format: "image/webp",
      quality: 90,
    });
  });

  it("feeds the original to input() and the rendered bytes to info()", async () => {
    await renderCleanWebp(new Uint8Array([9, 8, 7]).buffer);

    expect(mocks.input).toHaveBeenCalledOnce();
    expect(await bytesOf(mocks.input.mock.calls[0][0])).toEqual([9, 8, 7]);
    expect(mocks.info).toHaveBeenCalledOnce();
    expect(await bytesOf(mocks.info.mock.calls[0][0])).toEqual([
      ...new Uint8Array(PLAIN_WEBP),
    ]);
  });

  it("returns the bytes and the dimensions info reports", async () => {
    const result = await renderCleanWebp(new Uint8Array([9, 9]).buffer);

    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array(PLAIN_WEBP));
    expect(result.widthPx).toBe(640);
    expect(result.heightPx).toBe(480);
  });

  it("passes an extended WebP whose chunks carry no metadata", async () => {
    outputs(
      webp(
        chunk("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        chunk("ICCP", [1]),
        chunk("VP8 ", [1, 2, 3]),
      ),
    );

    await expect(
      renderCleanWebp(new Uint8Array([9]).buffer),
    ).resolves.toMatchObject({ widthPx: 640 });
  });

  // Fail closed: the "no metadata" guarantee was probed for JPEG input
  // only, so the output is checked rather than trusted.
  it.each(["EXIF", "XMP "])(
    "throws when the output carries an %s chunk",
    async (type) => {
      outputs(webp(chunk("VP8 ", [1, 2, 3]), chunk(type, [1, 2])));

      await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow(
        type.trim(),
      );
    },
  );

  it("throws when the output is not a RIFF WebP it can walk", async () => {
    outputs(new Uint8Array([1, 2, 3, 4]).buffer);

    await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow();
  });

  it("throws when a chunk runs past the end of the output", async () => {
    const truncated = new Uint8Array(webp(chunk("VP8 ", [1, 2, 3, 4])));
    outputs(truncated.slice(0, truncated.length - 2).buffer);

    await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow();
  });

  it("throws rather than walk an unbounded number of chunks", async () => {
    outputs(webp(...Array.from({ length: 65 }, () => chunk("ICCP", [1, 2]))));

    await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow(
      /too many chunks/,
    );
  });

  it("throws when info reports a non-WebP format", async () => {
    mocks.info.mockResolvedValue({
      format: "image/jpeg",
      fileSize: 4,
      width: 640,
      height: 480,
    });

    await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow(
      /image\/jpeg/,
    );
  });

  it("propagates a binding error", async () => {
    mocks.output.mockRejectedValue(new Error("9422 over quota"));

    await expect(renderCleanWebp(new Uint8Array([9]).buffer)).rejects.toThrow(
      "9422 over quota",
    );
  });
});

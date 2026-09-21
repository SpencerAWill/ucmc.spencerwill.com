import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import QRCode from "qrcode";

/**
 * Writes a single-frame Y4M video of a QR code, for Chromium's
 * `--use-file-for-fake-video-capture` flag.
 *
 * Why this exists: the gear-desk scanner's decode path — camera frame →
 * `BarcodeDetector` → (on browsers without a native one) the ZXing WASM
 * we serve from `/zxing-wasm/` — had no coverage at all. The unit tests
 * stub `BarcodeScanner` wholesale, and the loans spec says outright that
 * it "skips the camera path… the underlying decode happens in the
 * library, not our code". Both halves of that were wrong: Chromium's
 * fake-capture flags are entirely reliable, and the WASM binary IS ours
 * to serve. A stale one shipped and silently decoded nothing for months.
 *
 * Feeding a real QR through a real camera pipeline is the only way to
 * cover that seam, and it costs one small file.
 *
 * Y4M is deliberately hand-rolled rather than shelled out to ffmpeg:
 * the format is a text header plus raw planar YUV, `qrcode` hands us the
 * module matrix directly, and a build-time binary dependency for what is
 * three loops would be a poor trade. One frame is enough — Chromium
 * holds the last frame once the file is exhausted, so the code stays in
 * view for as long as the scanner runs.
 */

/** Rec.601 limited-range luma. ZXing binarizes on contrast, so the exact
 *  values don't matter much, but staying in-range avoids any clamping
 *  surprises in Chromium's colour conversion. */
const LUMA_WHITE = 235;
const LUMA_BLACK = 16;
const CHROMA_NEUTRAL = 128;

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

export interface FakeCameraFrame {
  path: string;
  /** The payload encoded in the frame, so a spec can assert on it. */
  text: string;
}

export function writeQrY4m(text: string, path: string): FakeCameraFrame {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;

  // Scale to the largest whole-pixel multiple that leaves a quiet zone.
  // A fractional scale would put module edges mid-pixel and soften the
  // very transitions the decoder keys on.
  const usable = Math.min(FRAME_WIDTH, FRAME_HEIGHT) - 80;
  const scale = Math.max(1, Math.floor(usable / size));
  const drawn = size * scale;
  const originX = Math.floor((FRAME_WIDTH - drawn) / 2);
  const originY = Math.floor((FRAME_HEIGHT - drawn) / 2);

  // Y plane starts all-white: that white border IS the quiet zone, which
  // the QR spec requires and ZXing will refuse the symbol without.
  const luma = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT, LUMA_WHITE);
  for (let row = 0; row < drawn; row += 1) {
    for (let col = 0; col < drawn; col += 1) {
      const moduleIndex =
        Math.floor(row / scale) * size + Math.floor(col / scale);
      if (data[moduleIndex]) {
        luma[(originY + row) * FRAME_WIDTH + (originX + col)] = LUMA_BLACK;
      }
    }
  }

  // 4:2:0 — one U and one V sample per 2x2 luma block, both neutral
  // because the frame is greyscale.
  const chromaSize = (FRAME_WIDTH / 2) * (FRAME_HEIGHT / 2);
  const chroma = Buffer.alloc(chromaSize, CHROMA_NEUTRAL);

  const header = Buffer.from(
    `YUV4MPEG2 W${FRAME_WIDTH} H${FRAME_HEIGHT} F25:1 Ip A1:1 C420jpeg\nFRAME\n`,
    "ascii",
  );

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, luma, chroma, chroma]));
  return { path, text };
}

/**
 * Chromium flags that replace the camera with `y4mPath`. `use-fake-ui`
 * auto-accepts the permission prompt, which headless Chromium otherwise
 * never resolves.
 */
export function fakeCameraArgs(y4mPath: string): string[] {
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${y4mPath}`,
  ];
}

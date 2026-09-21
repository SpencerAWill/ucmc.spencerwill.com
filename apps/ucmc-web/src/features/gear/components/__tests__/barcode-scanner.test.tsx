import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BarcodeScanner } from "#/features/gear/components/barcode-scanner";

/**
 * The bug these cover: a stale `zxing_reader.wasm` made every
 * `detector.detect()` call throw, and the scan loop caught and ignored
 * each one as if it were a not-ready video frame. The camera preview
 * stayed live, the toggle stayed on, and the scanner silently decoded
 * nothing for months on every browser without a native BarcodeDetector.
 *
 * So the contract is two-sided and both sides matter: a detector that
 * always throws has to surface, and one that throws occasionally must
 * NOT — a single bad frame is normal and retrying is the right answer.
 */

const FAILURE_LIMIT = 30;

function stubCameraStack(detect: () => Promise<{ rawValue: string }[]>) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });

  // jsdom doesn't implement playback, and `readyState` is a read-only
  // getter that always reports 0 — the loop skips every frame without
  // this, so nothing would ever be detected either way.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 2,
  });

  (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
    detect = detect;
  };

  // Drive the loop off the macrotask queue instead of real frames so the
  // failure threshold is reached in milliseconds rather than half a second.
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id);
  });
}

beforeEach(() => {
  window.localStorage.setItem("ucmc:gear-scanner:enabled", "true");
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.restoreAllMocks();
});

describe("BarcodeScanner detect-failure handling", () => {
  it("surfaces a detector that throws on every frame instead of scanning forever", async () => {
    stubCameraStack(() =>
      Promise.reject(new Error("table index is out of bounds")),
    );
    const onResult = vi.fn();

    render(<BarcodeScanner onResult={onResult} />);

    await waitFor(
      () => {
        expect(
          screen.getByText(/Scanner can't read the camera feed/i),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(onResult).not.toHaveBeenCalled();
  });

  it("keeps scanning through intermittent failures and still reports a decode", async () => {
    const calls = { n: 0 };
    // Fail well past a naive "any failure is fatal" threshold, but reset
    // the run with a success before the limit is reached.
    stubCameraStack(() => {
      calls.n += 1;
      if (calls.n < FAILURE_LIMIT - 5) {
        return Promise.reject(new Error("frame not ready"));
      }
      return Promise.resolve([{ rawValue: "ucmc-cart:abc" }]);
    });
    const onResult = vi.fn();

    render(<BarcodeScanner onResult={onResult} />);

    await waitFor(
      () => expect(onResult).toHaveBeenCalledWith("ucmc-cart:abc"),
      {
        timeout: 5000,
      },
    );
    expect(
      screen.queryByText(/Scanner can't read the camera feed/i),
    ).not.toBeInTheDocument();
  });
});

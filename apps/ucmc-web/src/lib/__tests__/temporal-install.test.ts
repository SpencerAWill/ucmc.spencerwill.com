import { Temporal as Polyfill } from "temporal-polyfill/implementation";
import { describe, expect, it, vi } from "vitest";

describe("temporal-install", () => {
  it("installs the polyfill as the global in this runtime", () => {
    expect(globalThis.Temporal).toBe(Polyfill);
  });

  it("replaces a native Temporal rather than deferring to it", async () => {
    // Stands in for cloudflare/workerd#6907: a native Temporal whose clock
    // reads epoch 0 while Date.now() is correct. It must be on the global
    // BEFORE the polyfill's modules evaluate: temporal-polyfill captures
    // `NativeTemporal` once, at module load, so planting it after the
    // setup file has already loaded them would let a regression to the
    // deferring `install()` pass unnoticed.
    const brokenNative = {
      Now: { instant: () => Polyfill.Instant.fromEpochMilliseconds(0) },
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, "Temporal");
    Object.defineProperty(globalThis, "Temporal", {
      value: brokenNative,
      configurable: true,
      writable: true,
    });
    try {
      vi.resetModules();
      await import("#/lib/temporal-install");
      expect(globalThis.Temporal).not.toBe(brokenNative);
      const drift = Math.abs(
        globalThis.Temporal.Now.instant().epochMilliseconds - Date.now(),
      );
      expect(drift).toBeLessThan(1000);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "Temporal", original);
      }
      vi.resetModules();
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

// `landingImageUrlFor` reads `env.VITE_R2_PUBLIC_HOST` at call time —
// mock the env module with a mutable object so each test can flip the
// CDN host on or off without re-importing.
const stubEnv: { VITE_R2_PUBLIC_HOST: string | undefined } = {
  VITE_R2_PUBLIC_HOST: undefined,
};

vi.mock("#/config/env", () => ({ env: stubEnv }));

const { landingImageUrlFor } = await import("#/features/landing/lib/image-url");

afterEach(() => {
  stubEnv.VITE_R2_PUBLIC_HOST = undefined;
});

describe("landingImageUrlFor", () => {
  it("falls back to /api/landing/* when VITE_R2_PUBLIC_HOST is unset", () => {
    expect(landingImageUrlFor("landing/hero/abc123.webp")).toBe(
      "/api/landing/hero/abc123.webp",
    );
  });

  it("emits a direct CDN URL when VITE_R2_PUBLIC_HOST is set", () => {
    stubEnv.VITE_R2_PUBLIC_HOST = "cdn.dev.ucmc.spencerwill.com";
    expect(landingImageUrlFor("landing/hero/abc123.webp")).toBe(
      "https://cdn.dev.ucmc.spencerwill.com/landing/hero/abc123.webp",
    );
  });

  it("preserves the full storage key in the CDN URL across subdirs", () => {
    stubEnv.VITE_R2_PUBLIC_HOST = "cdn.ucmc.spencerwill.com";
    expect(landingImageUrlFor("landing/about/deadbeef0badf00d.png")).toBe(
      "https://cdn.ucmc.spencerwill.com/landing/about/deadbeef0badf00d.png",
    );
  });

  it("strips the landing/ prefix only on the worker-route fallback", () => {
    expect(landingImageUrlFor("landing/activities/cafebabe.webp")).toBe(
      "/api/landing/activities/cafebabe.webp",
    );
  });
});

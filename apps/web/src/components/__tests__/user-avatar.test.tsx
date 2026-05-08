import { afterEach, describe, expect, it, vi } from "vitest";

// `avatarUrlFor` reads `env.VITE_R2_PUBLIC_HOST` at call time. Mock the
// env module with a mutable object so each test can flip the CDN host
// on or off without re-importing.
const stubEnv: { VITE_R2_PUBLIC_HOST: string | undefined } = {
  VITE_R2_PUBLIC_HOST: undefined,
};

vi.mock("#/config/env", () => ({ env: stubEnv }));

const { avatarUrlFor } = await import("#/components/user-avatar");

afterEach(() => {
  stubEnv.VITE_R2_PUBLIC_HOST = undefined;
});

describe("avatarUrlFor", () => {
  it("falls back to /api/avatars/* when VITE_R2_PUBLIC_HOST is unset", () => {
    expect(avatarUrlFor("avatars/user_abc/0123456789abcdef.webp")).toBe(
      "/api/avatars/avatars/user_abc/0123456789abcdef.webp",
    );
  });

  it("emits a direct CDN URL when VITE_R2_PUBLIC_HOST is set", () => {
    stubEnv.VITE_R2_PUBLIC_HOST = "cdn.dev.ucmc.spencerwill.com";
    expect(avatarUrlFor("avatars/user_abc/0123456789abcdef.webp")).toBe(
      "https://cdn.dev.ucmc.spencerwill.com/avatars/user_abc/0123456789abcdef.webp",
    );
  });
});

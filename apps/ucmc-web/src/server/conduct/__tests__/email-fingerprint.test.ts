import { describe, expect, it, vi } from "vitest";

import type * as EnvModule from "#/server/env.server";

// `serverEnv()` is cached per isolate, so the key is layered on top of it
// rather than written onto the binding object.
const keyOverride = vi.hoisted(() => ({
  value: undefined as string | undefined,
  set: false,
}));
vi.mock("#/server/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    serverEnv: () => ({
      ...actual.serverEnv(),
      ...(keyOverride.set ? { CONDUCT_EMAIL_KEY: keyOverride.value } : {}),
    }),
  };
});

const { emailFingerprint } =
  await import("#/server/conduct/email-fingerprint.server");

function withKey<T>(key: string | undefined, run: () => Promise<T>) {
  keyOverride.set = true;
  keyOverride.value = key;
  return run().finally(() => {
    keyOverride.set = false;
    keyOverride.value = undefined;
  });
}

describe("emailFingerprint", () => {
  it("is lowercase hex HMAC-SHA-256", async () => {
    expect(await emailFingerprint("a@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known HMAC-SHA-256 of the normalized address", async () => {
    const key = "k".repeat(32);
    const expected = await crypto.subtle
      .importKey(
        "raw",
        new TextEncoder().encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      )
      .then((k) =>
        crypto.subtle.sign(
          "HMAC",
          k,
          new TextEncoder().encode("a.b@gmail.com"),
        ),
      )
      .then((sig) =>
        [...new Uint8Array(sig)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
    expect(await withKey(key, () => emailFingerprint("a.b@gmail.com"))).toBe(
      expected,
    );
  });

  it("treats addresses normalizeEmail equates as the same", async () => {
    expect(await emailFingerprint("  A.B@Gmail.com ")).toBe(
      await emailFingerprint("a.b@gmail.com"),
    );
  });

  it("tells different addresses apart", async () => {
    expect(await emailFingerprint("a.b@gmail.com")).not.toBe(
      await emailFingerprint("ab@gmail.com"),
    );
  });

  it("depends on the key", async () => {
    const one = await withKey("1".repeat(32), () =>
      emailFingerprint("a@example.com"),
    );
    const two = await withKey("2".repeat(32), () =>
      emailFingerprint("a@example.com"),
    );
    expect(one).not.toBe(two);
  });

  it("throws rather than skipping the block when the key is unset", async () => {
    await expect(
      withKey(undefined, () => emailFingerprint("a@example.com")),
    ).rejects.toThrow(/CONDUCT_EMAIL_KEY/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { verifyTurnstile } from "#/features/auth/server/turnstile.server";
import type * as EnvModule from "#/server/env.server";

// `serverEnv()` is cached per isolate, so the secret is layered on top of
// it rather than written onto the binding object.
const turnstileEnv = vi.hoisted(() => ({
  TURNSTILE_SECRET_KEY: undefined as string | undefined,
}));
vi.mock("#/server/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    serverEnv: () => ({ ...actual.serverEnv(), ...turnstileEnv }),
  };
});

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
}));

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  turnstileEnv.TURNSTILE_SECRET_KEY = "secret";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("refuses an empty token without calling siteverify", async () => {
    // siteverify fails open when unreachable, so an empty token must be
    // refused before the call, or an outage would wave it through (#381).
    fetchSpy.mockRejectedValue(new Error("siteverify down"));
    expect(await verifyTurnstile("")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes everything when no secret is configured (local dev)", async () => {
    turnstileEnv.TURNSTILE_SECRET_KEY = undefined;
    expect(await verifyTurnstile("")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks siteverify about a non-empty token", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    expect(await verifyTurnstile("token")).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

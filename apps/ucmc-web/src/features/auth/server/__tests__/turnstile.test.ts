import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { verifyTurnstile } from "#/features/auth/server/turnstile.server";
import { env } from "#/server/cloudflare-env";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
}));

let fetchSpy: MockInstance<typeof fetch>;
let priorSecret: string | undefined;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  priorSecret = env.TURNSTILE_SECRET_KEY;
  env.TURNSTILE_SECRET_KEY = "secret";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorSecret === undefined) {
    delete env.TURNSTILE_SECRET_KEY;
  } else {
    env.TURNSTILE_SECRET_KEY = priorSecret;
  }
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
    delete env.TURNSTILE_SECRET_KEY;
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

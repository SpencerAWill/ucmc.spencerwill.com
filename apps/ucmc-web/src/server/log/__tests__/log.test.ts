import { afterEach, describe, expect, it, vi } from "vitest";

import { errorMessage, log, runWithLogContext } from "#/server/log/log.server";

/**
 * The logger's whole job is what reaches `console`, so that is what
 * these assert: the fields on the line, not that a function was called.
 */
function captureError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function captureInfo() {
  return vi.spyOn(console, "info").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorMessage", () => {
  it("redacts an email embedded in an error message", () => {
    // `redactString` substitutes the whole address — unlike
    // `redactEmail`, which masks the local part and keeps the domain.
    const message = errorMessage(
      new Error("UNIQUE constraint failed for alice@example.com"),
    );
    expect(message).toBe("UNIQUE constraint failed for <email-redacted>");
  });

  it("redacts a token-bearing URL, which is why it exists", () => {
    // The pre-logger call sites logged `err.message` raw. A fetch
    // failure carrying a magic-link URL is the case that motivated
    // redacting by default rather than per call site.
    const message = errorMessage(
      new Error("fetch failed: https://ucmc.test/auth/consume?token=sekrit"),
    );
    expect(message).not.toContain("sekrit");
  });

  it("handles a thrown non-Error", () => {
    expect(errorMessage("plain string")).toBe("plain string");
  });
});

describe("log context", () => {
  it("merges ambient fields into every line", () => {
    const spy = captureError();
    runWithLogContext({ requestId: "ray_1" }, () => {
      log.error("feedback.mirror_failed", { status: 500 });
    });
    expect(spy).toHaveBeenCalledWith("feedback.mirror_failed", {
      requestId: "ray_1",
      status: 500,
    });
  });

  it("survives an await, which is the reason it is AsyncLocalStorage", async () => {
    const spy = captureInfo();
    await runWithLogContext({ requestId: "ray_2" }, async () => {
      await Promise.resolve();
      log.info("retention.sweeps_complete", { sessions: 3 });
    });
    expect(spy).toHaveBeenCalledWith("retention.sweeps_complete", {
      requestId: "ray_2",
      sessions: 3,
    });
  });

  it("nests by merging onto the outer store rather than replacing it", () => {
    const spy = captureError();
    runWithLogContext({ requestId: "ray_3" }, () => {
      runWithLogContext({ cron: "0 8 * * *" }, () => {
        log.error("retention.sweep_failed", { sweep: "sessions" });
      });
    });
    expect(spy).toHaveBeenCalledWith("retention.sweep_failed", {
      requestId: "ray_3",
      cron: "0 8 * * *",
      sweep: "sessions",
    });
  });

  it("leaves no ambient fields outside a context", () => {
    const spy = captureError();
    log.error("rbac.cache_invalidation_failed", { roleId: "role_x" });
    expect(spy).toHaveBeenCalledWith("rbac.cache_invalidation_failed", {
      roleId: "role_x",
    });
  });
});

describe("levels", () => {
  it("drops debug under the default info threshold", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.debug("gear.scan_frame", { attempt: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits info and above, each through its same-named console method", () => {
    // Also pins that workerd implements all four — `console.debug` is
    // the one that gets assumed missing.
    const infoSpy = captureInfo();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = captureError();
    log.info("a.b");
    log.warn("c.d");
    log.error("e.f");
    expect(infoSpy).toHaveBeenCalledExactlyOnceWith("a.b", {});
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("c.d", {});
    expect(errSpy).toHaveBeenCalledExactlyOnceWith("e.f", {});
  });
});

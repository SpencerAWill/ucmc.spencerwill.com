import { describe, expect, it } from "vitest";

import {
  homePageCacheKey,
  isAnonymousHomePageRequest,
} from "#/server/edge-cache";

const ORIGIN = "https://example.com";

function makeRequest(
  pathAndQuery: string,
  init?: { method?: string; cookie?: string },
): Request {
  const headers = new Headers();
  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }
  return new Request(`${ORIGIN}${pathAndQuery}`, {
    method: init?.method ?? "GET",
    headers,
  });
}

describe("isAnonymousHomePageRequest", () => {
  it("returns true for GET / with no cookies", () => {
    expect(isAnonymousHomePageRequest(makeRequest("/"))).toBe(true);
  });

  it("returns true for GET / with a non-auth cookie", () => {
    expect(
      isAnonymousHomePageRequest(makeRequest("/", { cookie: "_ga=GA1.2.x" })),
    ).toBe(true);
  });

  it("returns true for GET / with a query string", () => {
    expect(isAnonymousHomePageRequest(makeRequest("/?utm_source=insta"))).toBe(
      true,
    );
  });

  it.each([
    ["ucmc_session=abc"],
    ["__Host-ucmc_session=abc"],
    ["ucmc_proof=xyz"],
    ["__Host-ucmc_proof=xyz"],
    ["ucmc_webauthn=qrs"],
    ["__Host-ucmc_webauthn=qrs"],
  ])("returns false for GET / with %s cookie", (cookie) => {
    expect(isAnonymousHomePageRequest(makeRequest("/", { cookie }))).toBe(
      false,
    );
  });

  it("returns false when an auth cookie is present alongside others", () => {
    expect(
      isAnonymousHomePageRequest(
        makeRequest("/", {
          cookie: "_ga=GA1.2.x; ucmc_session=abc; theme=dark",
        }),
      ),
    ).toBe(false);
  });

  it("does NOT false-positive on a tracking cookie value containing 'ucmc_session='", () => {
    // Defensive: a name-based parse should treat 'ucmc_session=abc' as a
    // *value* (not a name) when it appears after '='. This guards a future
    // sloppy substring check from regressing.
    expect(
      isAnonymousHomePageRequest(
        makeRequest("/", { cookie: "_evil=ucmc_session=fake" }),
      ),
    ).toBe(true);
  });

  it.each(["POST", "HEAD", "OPTIONS", "DELETE"])(
    "returns false for %s /",
    (method) => {
      expect(isAnonymousHomePageRequest(makeRequest("/", { method }))).toBe(
        false,
      );
    },
  );

  it.each(["/about", "/sign-in", "/announcements", "/foo"])(
    "returns false for GET %s with no cookies",
    (path) => {
      expect(isAnonymousHomePageRequest(makeRequest(path))).toBe(false);
    },
  );
});

describe("homePageCacheKey", () => {
  it("strips query strings so utm variants share an entry", () => {
    const a = homePageCacheKey(makeRequest("/?utm_source=insta"));
    const b = homePageCacheKey(makeRequest("/?utm_source=fb&ref=email"));
    expect(a.url).toBe(`${ORIGIN}/`);
    expect(b.url).toBe(`${ORIGIN}/`);
    expect(a.method).toBe("GET");
  });

  it("preserves the request origin", () => {
    const request = new Request("https://other.example/", { method: "GET" });
    expect(homePageCacheKey(request).url).toBe("https://other.example/");
  });
});

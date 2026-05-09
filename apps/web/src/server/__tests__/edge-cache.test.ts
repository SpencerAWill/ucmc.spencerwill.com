import { describe, expect, it } from "vitest";

import {
  isCacheablePublicPageRequest,
  publicPageCacheKey,
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

describe("isCacheablePublicPageRequest", () => {
  it("returns true for GET / with no cookies", () => {
    expect(isCacheablePublicPageRequest(makeRequest("/"))).toBe(true);
  });

  it("returns true for GET / with a non-auth cookie", () => {
    expect(
      isCacheablePublicPageRequest(makeRequest("/", { cookie: "_ga=GA1.2.x" })),
    ).toBe(true);
  });

  it("returns true for GET / with a query string", () => {
    expect(
      isCacheablePublicPageRequest(makeRequest("/?utm_source=insta")),
    ).toBe(true);
  });

  it.each([
    "/about",
    "/membership",
    "/legal",
    "/disclaimer",
    "/anti-hazing",
    "/nondiscrimination",
    "/waiver",
    "/privacy",
    "/terms",
    "/open-source",
  ])("returns true for GET %s with no cookies", (path) => {
    expect(isCacheablePublicPageRequest(makeRequest(path))).toBe(true);
  });

  it.each([
    ["ucmc_session=abc"],
    ["__Host-ucmc_session=abc"],
    ["ucmc_proof=xyz"],
    ["__Host-ucmc_proof=xyz"],
    ["ucmc_webauthn=qrs"],
    ["__Host-ucmc_webauthn=qrs"],
  ])("returns false for GET / with %s cookie", (cookie) => {
    expect(isCacheablePublicPageRequest(makeRequest("/", { cookie }))).toBe(
      false,
    );
  });

  it("returns false for any cacheable path when an auth cookie is present", () => {
    // The auth-cookie gate applies to every path uniformly. Spot-check
    // one of the legal routes to make sure the bypass is on cookies,
    // not just `/`.
    expect(
      isCacheablePublicPageRequest(
        makeRequest("/privacy", { cookie: "ucmc_session=abc" }),
      ),
    ).toBe(false);
  });

  it("returns false when an auth cookie is present alongside others", () => {
    expect(
      isCacheablePublicPageRequest(
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
      isCacheablePublicPageRequest(
        makeRequest("/", { cookie: "_evil=ucmc_session=fake" }),
      ),
    ).toBe(true);
  });

  it.each(["POST", "HEAD", "OPTIONS", "DELETE"])(
    "returns false for %s /",
    (method) => {
      expect(isCacheablePublicPageRequest(makeRequest("/", { method }))).toBe(
        false,
      );
    },
  );

  it.each([
    "/sign-in",
    "/announcements",
    "/feedback",
    "/my/account",
    "/members",
    "/foo",
    "/about/extra",
  ])("returns false for non-cacheable path %s", (path) => {
    expect(isCacheablePublicPageRequest(makeRequest(path))).toBe(false);
  });
});

describe("publicPageCacheKey", () => {
  it("strips query strings so utm variants share an entry", () => {
    const a = publicPageCacheKey(makeRequest("/?utm_source=insta"));
    const b = publicPageCacheKey(makeRequest("/?utm_source=fb&ref=email"));
    expect(a.url).toBe(`${ORIGIN}/`);
    expect(b.url).toBe(`${ORIGIN}/`);
    expect(a.method).toBe("GET");
  });

  it("preserves the request path so different cacheable pages get different keys", () => {
    expect(publicPageCacheKey(makeRequest("/")).url).toBe(`${ORIGIN}/`);
    expect(publicPageCacheKey(makeRequest("/privacy")).url).toBe(
      `${ORIGIN}/privacy`,
    );
    expect(publicPageCacheKey(makeRequest("/about?ref=x")).url).toBe(
      `${ORIGIN}/about`,
    );
  });

  it("preserves the request origin", () => {
    const request = new Request("https://other.example/legal", {
      method: "GET",
    });
    expect(publicPageCacheKey(request).url).toBe("https://other.example/legal");
  });
});

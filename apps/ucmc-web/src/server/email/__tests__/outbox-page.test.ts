import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  handleOutbox,
  linkify,
  renderOutbox,
} from "#/server/email/outbox-page.server";
import type { OutboxEmail } from "#/server/email/outbox.server";

const TEAM = "team.cloudflareaccess.com";
const AUD = "0123456789abcdef".repeat(4);
const settings = {
  enabled: true,
  teamDomain: TEAM,
  aud: AUD,
  appBaseUrl: "https://dev.example.com",
};

const keys = await generateKeyPair("RS256");
const otherKeys = await generateKeyPair("RS256");
const jwks = {
  keys: [
    {
      ...(await exportJWK(keys.publicKey)),
      kid: "k1",
      alg: "RS256",
      use: "sig",
    },
  ],
};

/** Serves the team's published keys; any other request is a test bug. */
function serveAccessCerts() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      return Response.json(jwks);
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

interface TokenOptions {
  aud?: string[];
  issuer?: string;
  key?: CryptoKey;
  expiresIn?: string;
  claims?: Record<string, unknown>;
}

function token({
  aud = [AUD],
  issuer = `https://${TEAM}`,
  key = keys.privateKey,
  expiresIn = "5m",
  claims = { email: "me@example.com" },
}: TokenOptions = {}) {
  // Access sends `aud` as an array even with one tag.
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

const request = (jwt?: string) =>
  new Request("https://dev.example.com/dev/outbox", {
    headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
  });

const email: OutboxEmail = {
  id: "e1",
  kind: "auth.magic_link",
  to: "alice@example.com",
  subject: "Sign in <now>",
  text: "Use https://dev.example.com/auth/callback?token=abc or https://evil.example/x",
  createdAt: Temporal.Instant.from("2026-10-18T12:00:00Z"),
};
const list = () => Promise.resolve([email]);

describe("/dev/outbox", () => {
  it("doesn't exist unless the outbox is on", async () => {
    const res = await handleOutbox(
      request(await token()),
      { ...settings, enabled: false },
      list,
    );
    expect(res.status).toBe(404);
  });

  it("doesn't exist without the Access settings to check against", async () => {
    const res = await handleOutbox(
      request(await token()),
      { ...settings, aud: undefined },
      list,
    );
    expect(res.status).toBe(404);
  });

  it("lists the emails for a valid Access token, uncached and unindexed", async () => {
    serveAccessCerts();

    const res = await handleOutbox(request(await token()), settings, list);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toMatch(/noindex/);
    expect(await res.text()).toContain("Sign in &lt;now&gt;");
  });

  it.each([
    ["no token", undefined],
    ["the wrong audience", { aud: ["another-app"] }],
    ["the wrong issuer", { issuer: "https://other.cloudflareaccess.com" }],
    ["a key Access didn't publish", { key: otherKeys.privateKey }],
    ["an expired token", { expiresIn: "-1m" }],
    // A service token: Access signs it, but it names no person.
    ["a token with no email", { claims: { common_name: "abc.access" } }],
  ] satisfies Array<[string, TokenOptions | undefined]>)(
    "refuses %s",
    async (_, options) => {
      serveAccessCerts();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const listSpy = vi.fn(list);

      const jwt = options === undefined ? undefined : await token(options);
      const res = await handleOutbox(request(jwt), settings, listSpy);

      expect(res.status).toBe(403);
      expect(listSpy).not.toHaveBeenCalled();
    },
  );
});

describe("rendering", () => {
  it("links only this app's own URLs", () => {
    const html = linkify(email.text, settings.appBaseUrl);
    expect(html).toContain(
      '<a href="https://dev.example.com/auth/callback?token=abc">',
    );
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain("https://evil.example/x");
  });

  it("escapes everything, link text included", () => {
    expect(linkify('<script>alert("x")</script>', settings.appBaseUrl)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const html = renderOutbox(
      [{ ...email, to: "<b>@example.com", kind: "<i>" }],
      settings.appBaseUrl,
    );
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
  });

  it("shows times in the club's zone, not the Worker's UTC", () => {
    expect(renderOutbox([email], settings.appBaseUrl)).toContain(
      "2026-10-18 08:00:00 -04:00",
    );
  });

  it("says when there's nothing yet", () => {
    expect(renderOutbox([], settings.appBaseUrl)).toContain("Nothing yet.");
  });
});

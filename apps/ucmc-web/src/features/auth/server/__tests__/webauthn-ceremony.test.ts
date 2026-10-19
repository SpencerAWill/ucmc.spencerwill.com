import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
}));

const { readCeremonyCookie, writeCeremonyCookie } =
  await import("#/features/auth/server/webauthn-ceremony.server");
const { newCeremony } =
  await import("#/features/auth/server/webauthn-challenge.server");
const { signJson } = await import("#/server/auth/signing.server");

// Local dev / tests serve over http, so the cookie has no `__Host-` prefix.
const COOKIE = "ucmc_webauthn";
const NOW = Temporal.Instant.from("2026-10-19T12:00:00Z");

beforeEach(() => {
  cookieJar.clear();
});

describe("ceremony cookie", () => {
  it("round-trips a ceremony", async () => {
    const ceremony = newCeremony(
      { challenge: "abc", type: "register", userId: "user_1" },
      NOW,
    );

    await writeCeremonyCookie(ceremony);

    expect(await readCeremonyCookie(NOW)).toEqual(ceremony);
  });

  it("is undefined when there is no cookie", async () => {
    expect(await readCeremonyCookie(NOW)).toBeUndefined();
  });

  it("refuses an expired ceremony", async () => {
    const ceremony = newCeremony(
      { challenge: "abc", type: "authenticate" },
      NOW,
    );
    await writeCeremonyCookie(ceremony);

    const atExpiry = Temporal.Instant.fromEpochMilliseconds(ceremony.expiresAt);
    expect(await readCeremonyCookie(atExpiry)).toBeNull();
  });

  // The cookie is client-held, so the signature is the whole defence: a
  // visitor who could rewrite the challenge could answer one they chose.
  it("refuses a ceremony whose payload was edited", async () => {
    await writeCeremonyCookie(
      newCeremony({ challenge: "abc", type: "authenticate" }, NOW),
    );
    const [, signature] = cookieJar.get(COOKIE)!.split(".");
    const forged = btoa(
      JSON.stringify({
        id: "x",
        challenge: "attacker-chosen",
        type: "authenticate",
        expiresAt: NOW.add({ hours: 1 }).epochMilliseconds,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    cookieJar.set(COOKIE, `${forged}.${signature}`);

    expect(await readCeremonyCookie(NOW)).toBeNull();
  });

  it("refuses a value signed for a different purpose", async () => {
    const ceremony = newCeremony(
      { challenge: "abc", type: "authenticate" },
      NOW,
    );
    cookieJar.set(COOKIE, await signJson("some-other-cookie", ceremony));

    expect(await readCeremonyCookie(NOW)).toBeNull();
  });

  it("refuses a signed value that isn't a ceremony", async () => {
    cookieJar.set(
      COOKIE,
      await signJson("webauthn-ceremony", { email: "a@example.com" }),
    );

    expect(await readCeremonyCookie(NOW)).toBeNull();
  });

  it("refuses garbage", async () => {
    cookieJar.set(COOKIE, "not-a-signed-value");

    expect(await readCeremonyCookie(NOW)).toBeNull();
  });
});

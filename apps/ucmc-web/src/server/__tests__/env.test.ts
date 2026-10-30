import { describe, expect, it } from "vitest";

import {
  configurationProblems,
  parseServerEnv,
  serverEnv,
} from "#/server/env.server";
import type { ServerEnv } from "#/server/env.server";

const LOCAL = {
  APP_BASE_URL: "http://localhost:3000",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_RP_NAME: "UCMC (local)",
  RESEND_FROM_NAME: "UCMC (local)",
};

const PROD: ServerEnv = {
  APP_BASE_URL: "https://ucmc.spencerwill.com",
  WEBAUTHN_RP_ID: "ucmc.spencerwill.com",
  WEBAUTHN_RP_NAME: "UCMC",
  RESEND_FROM: "noreply@ucmc.spencerwill.com",
  RESEND_FROM_NAME: "UCMC",
  RESEND_API_KEY: "re_live",
  SESSION_SECRET: "x".repeat(32),
  TURNSTILE_SECRET_KEY: "secret",
};
const PROD_CLIENT = { VITE_TURNSTILE_SITE_KEY: "site" };

const DEV_OUTBOX: ServerEnv = {
  ...PROD,
  APP_BASE_URL: "https://dev.ucmc.spencerwill.com",
  WEBAUTHN_RP_ID: "dev.ucmc.spencerwill.com",
  RESEND_FROM: undefined,
  RESEND_API_KEY: undefined,
  EMAIL_OUTBOX: "1",
  ACCESS_TEAM_DOMAIN: "ucmc.cloudflareaccess.com",
  ACCESS_OUTBOX_AUD: "aud",
};

function parsed(source: Record<string, unknown>): ServerEnv {
  const result = parseServerEnv(source);
  if (!result.ok) {
    throw new Error(result.problems.join("; "));
  }
  return result.env;
}

describe("parseServerEnv", () => {
  it("accepts the local .env.example shape, blanks meaning unset", () => {
    const env = parsed({
      ...LOCAL,
      RESEND_API_KEY: "",
      SESSION_SECRET: "",
    });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("ignores bindings and anything else on the env object", () => {
    expect(() =>
      parsed({ ...LOCAL, DB: {}, SOMETHING_ELSE: "x" }),
    ).not.toThrow();
  });

  it("reports an unparseable APP_BASE_URL rather than throwing", () => {
    const result = parseServerEnv({ ...LOCAL, APP_BASE_URL: "not a url" });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems).toEqual([
      expect.stringMatching(/^APP_BASE_URL: /),
    ]);
  });

  it("names each bad variable and never echoes its value", () => {
    const result = parseServerEnv({
      ...LOCAL,
      APP_BASE_URL: "https://example.com/",
      SESSION_SECRET: "short-secret-value",
      RESEND_API_KEY: "sk_wrong_provider",
      WEBAUTHN_RP_ID: undefined,
    });
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.problems;
    expect(problems.map((p) => p.split(":")[0]).sort()).toEqual([
      "APP_BASE_URL",
      "RESEND_API_KEY",
      "SESSION_SECRET",
      "WEBAUTHN_RP_ID",
    ]);
    const text = problems.join("\n");
    expect(text).not.toContain("short-secret-value");
    expect(text).not.toContain("sk_wrong_provider");
  });
});

describe("configurationProblems", () => {
  it("passes prod and the dev outbox as infra configures them", () => {
    expect(configurationProblems(PROD, PROD_CLIENT)).toEqual([]);
    expect(configurationProblems(DEV_OUTBOX, PROD_CLIENT)).toEqual([]);
  });

  it("passes a bare local checkout, which has no email or secret yet", () => {
    expect(configurationProblems(parsed(LOCAL), {})).toEqual([]);
  });

  it("allows a stale RESEND_API_KEY beside the outbox, which wins (ADR 0001)", () => {
    expect(
      configurationProblems(
        { ...DEV_OUTBOX, RESEND_API_KEY: "re_stale" },
        PROD_CLIENT,
      ),
    ).toEqual([]);
  });

  it.each<[string, Partial<ServerEnv>, Partial<typeof PROD_CLIENT>, RegExp]>([
    ["no session secret", { SESSION_SECRET: undefined }, {}, /SESSION_SECRET/],
    [
      "no email provider",
      { RESEND_API_KEY: undefined },
      {},
      /no email provider/,
    ],
    ["Mailpit", { MAILPIT_URL: "http://mailpit:8025" }, {}, /MAILPIT_URL/],
    [
      "the e2e rate-limit bypass",
      { E2E_BYPASS_RATE_LIMIT: "1" },
      {},
      /E2E_BYPASS_RATE_LIMIT/,
    ],
    [
      "no Turnstile",
      { TURNSTILE_SECRET_KEY: undefined },
      { VITE_TURNSTILE_SITE_KEY: undefined },
      /required when deployed/,
    ],
    [
      "a Turnstile secret without its site key",
      {},
      { VITE_TURNSTILE_SITE_KEY: undefined },
      /together/,
    ],
    [
      "an RP ID that isn't the app's host",
      { WEBAUTHN_RP_ID: "dev.ucmc.spencerwill.com" },
      {},
      /WEBAUTHN_RP_ID/,
    ],
    ["Resend with no sender", { RESEND_FROM: undefined }, {}, /RESEND_FROM/],
  ])("refuses a deployed Worker with %s", (_, env, client, problem) => {
    const problems = configurationProblems(
      { ...PROD, ...env },
      { ...PROD_CLIENT, ...client },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(problem);
  });

  it("accepts an RP ID that is a parent domain of the app's host", () => {
    expect(
      configurationProblems(
        { ...DEV_OUTBOX, WEBAUTHN_RP_ID: "spencerwill.com" },
        PROD_CLIENT,
      ),
    ).toEqual([]);
  });

  it("refuses the outbox without Access's settings, even locally", () => {
    const problems = configurationProblems(
      parsed({ ...LOCAL, EMAIL_OUTBOX: "1" }),
      {},
    );
    expect(problems).toEqual([
      expect.stringMatching(/ACCESS_TEAM_DOMAIN and ACCESS_OUTBOX_AUD/),
    ]);
  });

  it("refuses half a Turnstile pair locally too", () => {
    expect(
      configurationProblems(
        parsed({ ...LOCAL, TURNSTILE_SECRET_KEY: "s" }),
        {},
      ),
    ).toEqual([expect.stringMatching(/together/)]);
  });
});

describe("serverEnv", () => {
  it("validates the pool's Worker vars", () => {
    expect(serverEnv().APP_BASE_URL).toBe("http://localhost:3000");
  });
});

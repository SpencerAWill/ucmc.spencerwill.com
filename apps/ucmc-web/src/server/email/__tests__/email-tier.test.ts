import { describe, expect, it } from "vitest";

import { emailTier } from "#/server/email/email-tier";

const ACCESS = {
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_OUTBOX_AUD: "outbox-aud",
};

describe("emailTier", () => {
  it("uses Resend when only its key is set", () => {
    expect(emailTier({ RESEND_API_KEY: "re_x" })).toEqual({ tier: "resend" });
  });

  it("keeps Resend ahead of Mailpit, as before the outbox", () => {
    expect(
      emailTier({ RESEND_API_KEY: "re_x", MAILPIT_URL: "http://mailpit:8025" }),
    ).toEqual({ tier: "resend" });
  });

  it("uses Mailpit when only its URL is set", () => {
    expect(emailTier({ MAILPIT_URL: "http://mailpit:8025" })).toEqual({
      tier: "mailpit",
    });
  });

  it("puts the outbox ahead of a stale Resend key", () => {
    // A Worker secret outlives the deploy that stopped uploading it, so
    // dev can still carry RESEND_API_KEY after #297. EMAIL_OUTBOX means
    // "do not send", and must keep meaning it.
    expect(
      emailTier({ EMAIL_OUTBOX: "1", RESEND_API_KEY: "re_stale", ...ACCESS }),
    ).toEqual({ tier: "outbox" });
  });

  it("lets Mailpit win over the outbox, so local development is unchanged", () => {
    expect(
      emailTier({
        EMAIL_OUTBOX: "1",
        MAILPIT_URL: "http://mailpit:8025",
        ...ACCESS,
      }),
    ).toEqual({ tier: "mailpit" });
  });

  it.each([
    ["no Access settings", {}],
    ["no audience", { ACCESS_TEAM_DOMAIN: ACCESS.ACCESS_TEAM_DOMAIN }],
    ["no team domain", { ACCESS_OUTBOX_AUD: ACCESS.ACCESS_OUTBOX_AUD }],
  ])("refuses the outbox with %s", (_, access) => {
    // Falling through to Resend here would put real mail on the wire
    // from a Worker that asked not to send any.
    const tier = emailTier({
      EMAIL_OUTBOX: "1",
      RESEND_API_KEY: "re_stale",
      ...access,
    });
    expect(tier.tier).toBe("none");
  });

  it("has no fallback when nothing is configured", () => {
    const tier = emailTier({});
    expect(tier.tier).toBe("none");
    expect(tier).toHaveProperty(
      "reason",
      expect.stringMatching(/RESEND_API_KEY, MAILPIT_URL/),
    );
  });
});

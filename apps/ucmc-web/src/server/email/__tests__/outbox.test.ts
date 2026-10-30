import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as EnvModule from "#/server/env.server";
import { getDb, schema } from "#/server/db";
import type { EmailMessage } from "#/server/email/resend";

// Only the email-tier vars are overridden, on top of the real validated
// env; the bindings (`getDb()`) are untouched.
const emailEnv = vi.hoisted(() => ({
  RESEND_API_KEY: undefined as string | undefined,
  MAILPIT_URL: undefined as string | undefined,
  EMAIL_OUTBOX: undefined as string | undefined,
  ACCESS_TEAM_DOMAIN: undefined as string | undefined,
  ACCESS_OUTBOX_AUD: undefined as string | undefined,
  RESEND_FROM: undefined as string | undefined,
}));

vi.mock("#/server/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    serverEnv: () => ({ ...actual.serverEnv(), ...emailEnv }),
  };
});

const { listOutbox, storeInOutbox, sweepEmailOutbox } =
  await import("#/server/email/outbox.server");
const { EmailNotConfiguredError, magicLinkEmail, sendEmail } =
  await import("#/server/email/resend");
const { resendConfigured } = await import("#/server/cost/resend-rollup.server");

const NOW = Temporal.Instant.from("2026-10-18T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

const message: EmailMessage = magicLinkEmail({
  to: "alice@example.com",
  url: "https://dev.ucmc.spencerwill.com/auth/verify?token=abc",
  intent: "login",
});

beforeEach(() => {
  for (const key of Object.keys(emailEnv) as Array<keyof typeof emailEnv>) {
    emailEnv[key] = undefined;
  }
});

afterEach(async () => {
  await getDb().delete(schema.emailOutbox);
  await getDb().delete(schema.emailSends);
  vi.restoreAllMocks();
});

describe("the outbox store", () => {
  it("keeps the whole message, so a sign-in link can be read back", async () => {
    await storeInOutbox(message, NOW);

    const [row] = await listOutbox({ now: NOW });
    expect(row).toMatchObject({
      kind: "auth.magic_link",
      to: "alice@example.com",
      subject: message.subject,
      text: message.text,
    });
    expect(row.createdAt.epochMilliseconds).toBe(NOW.epochMilliseconds);
  });

  it("lists newest first", async () => {
    await storeInOutbox({ ...message, subject: "older" }, NOW);
    await storeInOutbox(
      { ...message, subject: "newer" },
      NOW.add({ milliseconds: 1000 }),
    );

    const rows = await listOutbox({ now: NOW.add({ milliseconds: 1000 }) });
    expect(rows.map((r) => r.subject)).toEqual(["newer", "older"]);
  });

  it("forgets a message after a day, on read", async () => {
    // Prune-on-read is what keeps a day's limit on a Worker whose cron
    // hasn't run since the row was written.
    await storeInOutbox(message, NOW.subtract({ milliseconds: 25 * HOUR_MS }));
    await storeInOutbox(message, NOW.subtract({ milliseconds: 23 * HOUR_MS }));

    expect(await listOutbox({ now: NOW })).toHaveLength(1);
    expect(await getDb().select().from(schema.emailOutbox)).toHaveLength(1);
  });

  it("sweeps on its own too, for the daily retention tick", async () => {
    await storeInOutbox(message, NOW.subtract({ milliseconds: 25 * HOUR_MS }));

    expect(await sweepEmailOutbox(NOW)).toBe(1);
  });
});

describe("sendEmail with the outbox on", () => {
  beforeEach(() => {
    emailEnv.EMAIL_OUTBOX = "1";
    emailEnv.ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
    emailEnv.ACCESS_OUTBOX_AUD = "outbox-aud";
  });

  it("stores the message instead of sending it, even with a stale Resend key", async () => {
    emailEnv.RESEND_API_KEY = "re_stale";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await sendEmail(message);

    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await getDb().select().from(schema.emailOutbox);
    expect(rows.map((r) => r.to)).toEqual(["alice@example.com"]);
  });

  it("counts the send in the usage log, as Mailpit's are", async () => {
    await sendEmail(message);

    const sends = await getDb().select().from(schema.emailSends);
    expect(sends.map((s) => [s.kind, s.ok])).toEqual([
      ["auth.magic_link", true],
    ]);
  });

  it("refuses to send at all without the Access settings", async () => {
    emailEnv.ACCESS_OUTBOX_AUD = undefined;
    emailEnv.RESEND_API_KEY = "re_stale";

    await expect(sendEmail(message)).rejects.toBeInstanceOf(
      EmailNotConfiguredError,
    );
    expect(await getDb().select().from(schema.emailOutbox)).toHaveLength(0);
  });
});

describe("sendEmail without a sending address", () => {
  it("refuses Resend and Mailpit rather than sending from <undefined>", async () => {
    // Dev no longer receives RESEND_FROM (#297); a Worker that somehow
    // reaches a sending tier without it must fail as configuration.
    emailEnv.MAILPIT_URL = "http://127.0.0.1:1";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(sendEmail(message)).rejects.toThrow(/RESEND_FROM/);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Configuration, not a send attempt: nothing in the usage log.
    expect(await getDb().select().from(schema.emailSends)).toHaveLength(0);
  });

  it("isn't needed by the outbox, which sends nothing", async () => {
    emailEnv.EMAIL_OUTBOX = "1";
    emailEnv.ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
    emailEnv.ACCESS_OUTBOX_AUD = "outbox-aud";

    await sendEmail(message);

    expect(await getDb().select().from(schema.emailOutbox)).toHaveLength(1);
  });
});

describe("resendConfigured", () => {
  it("is false only on an outbox Worker", () => {
    emailEnv.EMAIL_OUTBOX = "1";
    emailEnv.ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
    emailEnv.ACCESS_OUTBOX_AUD = "outbox-aud";
    expect(resendConfigured()).toBe(false);
  });

  it("stays true on a Worker that has lost its Resend key", () => {
    // Prod with its secret dropped: sends fail loudly, and the rollup
    // must keep running rather than file the outage as "unconfigured".
    expect(resendConfigured()).toBe(true);
  });
});

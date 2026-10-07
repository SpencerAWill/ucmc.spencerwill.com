import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CloudflareEnvModule from "#/server/cloudflare-env";

/**
 * `/health` is the post-deploy gate: `deploy.yml` runs a smoke spec that
 * fails the deploy when this reports anything but `pass`. It had no
 * tests, which meant the check guarding every production deploy was
 * itself unverified.
 *
 * D1, KV and R2 stay REAL here — the workers pool runs in workerd with
 * Miniflare — so `pass` means the probes genuinely reached a binding
 * rather than that a mock agreed with them.
 *
 * Only the two email vars are controlled, and only because they would
 * otherwise make the suite environment-dependent: `.env.local` sets
 * `MAILPIT_URL` on a developer's machine and CI sets neither, so the
 * email probe reports a different name in each place. That is exactly
 * the kind of test that passes locally and fails on a runner.
 */

// The rate-limit wrapper needs a request context the pool doesn't
// provide, so it is mocked as every other workers-pool test does. Kept
// as a mutable flag so the short-circuit branch — the one most worth
// covering — can be exercised.
const rateLimitAllowed = vi.hoisted(() => ({ value: true }));
vi.mock("#/server/rate-limit.server", () => ({
  checkHealthRateLimit: async () => rateLimitAllowed.value,
}));

// Overrides ONLY `RESEND_API_KEY` / `MAILPIT_URL`. A wholesale mock of
// this module would take `DB`, `KV` and the buckets with it — `getDb()`
// reads `env` from right here — and the probes would then be testing the
// mock. The Proxy leaves every other binding untouched.
const emailEnv = vi.hoisted(() => ({
  RESEND_API_KEY: undefined as string | undefined,
  MAILPIT_URL: undefined as string | undefined,
}));

vi.mock("#/server/cloudflare-env", async (importOriginal) => {
  const actual = await importOriginal<typeof CloudflareEnvModule>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, prop, receiver) {
        if (prop === "RESEND_API_KEY" || prop === "MAILPIT_URL") {
          return emailEnv[prop];
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }),
  };
});

const { performHealthChecks } = await import("#/server/health.server");

beforeEach(() => {
  rateLimitAllowed.value = true;
  emailEnv.RESEND_API_KEY = undefined;
  emailEnv.MAILPIT_URL = undefined;
});

describe("performHealthChecks", () => {
  it("probes D1, R2, KV and email, and names each one", async () => {
    const report = await performHealthChecks();
    const names = report.checks.map((c) => c.name);

    expect(names).toHaveLength(4);
    for (const prefix of ["d1:", "r2:", "kv:", "email:"]) {
      expect(
        names.some((n) => n.startsWith(prefix)),
        `no ${prefix} probe in ${names.join(", ")}`,
      ).toBe(true);
    }
  });

  it("passes the infrastructure probes against real bindings", async () => {
    const report = await performHealthChecks();
    const infra = report.checks.filter((c) => !c.name.startsWith("email:"));

    expect(
      infra.map((c) => [c.name, c.status]),
      JSON.stringify(report.checks, null, 2),
    ).toEqual(infra.map((c) => [c.name, "pass"]));
  });

  it("treats a missing email provider as a hard failure", async () => {
    // Documented behaviour, and the reason it isn't a warning: with no
    // provider, `sendEmail` throws and every magic-link request 500s. A
    // `pass`-with-a-warning here misled operators in an earlier
    // revision.
    const report = await performHealthChecks();
    const email = report.checks.find((c) => c.name.startsWith("email:"));

    expect(email?.name).toBe("email:misconfigured");
    expect(email?.status).toBe("fail");
    expect(email?.output).toMatch(/RESEND_API_KEY or MAILPIT_URL/);
  });

  it("fails the whole report when a single probe fails", async () => {
    // The infra probes pass above, so this isolates the aggregation:
    // one failing check is enough, which is what makes the deploy gate
    // meaningful.
    const report = await performHealthChecks();

    expect(report.checks.filter((c) => c.status === "fail")).toHaveLength(1);
    expect(report.status).toBe("fail");
  });

  it("reports an unreachable Mailpit as a failure, not an absence", async () => {
    // Port 1 is reliably closed. Distinguishes "configured but down"
    // from "not configured" — they are different operator problems and
    // the probe names them differently.
    emailEnv.MAILPIT_URL = "http://127.0.0.1:1";

    const report = await performHealthChecks();
    const email = report.checks.find((c) => c.name.startsWith("email:"));

    expect(email?.name).toBe("email:mailpit");
    expect(email?.status).toBe("fail");
  });

  it("stamps every check with a parseable timestamp", async () => {
    const report = await performHealthChecks();

    for (const check of report.checks) {
      expect(
        Number.isNaN(Date.parse(check.time)),
        `check ${check.name} has an unparseable time: ${check.time}`,
      ).toBe(false);
    }
  });

  it("short-circuits on the rate limiter without touching D1 or R2", async () => {
    // The ordering is the point, not an optimisation: /health is public
    // and unauthenticated, so a flood must not amplify into one D1 read
    // and one R2 HEAD per request. A lone `rate-limit` check in the
    // report is what proves nothing else ran.
    rateLimitAllowed.value = false;

    const report = await performHealthChecks();

    expect(report.status).toBe("fail");
    expect(report.checks.map((c) => c.name)).toEqual(["rate-limit"]);
    expect(report.checks[0].output).toMatch(/too many requests/i);
  });
});

/**
 * The Worker's vars and secrets, validated (#319).
 *
 * Bindings (D1, KV, R2, Images, rate limiters) are not here: they keep
 * going through `getDb()` / `getKv()` / the bucket getters, typed by
 * `WorkerEnv` in `./cloudflare-env`. Everything else a handler reads —
 * every var from `wrangler.jsonc`, every secret from `--secrets-file` or
 * `.env.local` — is read as `serverEnv().NAME`.
 *
 * `serverEnv()` parses on first use and caches for the life of the
 * isolate (a deploy or a secret change starts new isolates). Two layers:
 *
 *   1. the schema, which checks each variable on its own; and
 *   2. `configurationProblems()`, which checks settings that are valid
 *      one by one but wrong together.
 *
 * `server-entry.ts` calls it before every request and every cron tick,
 * so a misconfigured deploy fails **every** request from the first one
 * — which the post-deploy smoke test catches — instead of whichever
 * request first touches the bad variable.
 *
 * Errors name variables, never values: the values are secrets.
 *
 * Adding a variable: add it to the schema, document it in `.env.example`,
 * and either teach `scripts/wrangler-env.ts` the var or add the secret to
 * `.github/actions/deploy`.
 */
import { z } from "zod";

import { env as clientEnv } from "#/config/env";
import { env as workerEnv } from "#/server/cloudflare-env";
import { emailTier } from "#/server/email/email-tier";

/**
 * `.env.example` ships blank lines (`RESEND_API_KEY=`) and `sync-env`
 * leaves an empty stack output out, but a blank can still arrive; it
 * means "unset", so an optional variable must not then fail `min(1)`.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const serverEnvSchema = z.object({
  // The app's origin, with no path or trailing slash: sign-in links are
  // `${APP_BASE_URL}${path}`, and whether cookies are Secure comes from
  // its scheme.
  APP_BASE_URL: z
    .url({ protocol: /^https?$/ })
    // `z.url` reports an unparseable value; this check runs anyway (Zod
    // continues past a failed format check), so it must not throw on one.
    .refine(
      (v) => !URL.canParse(v) || new URL(v).origin === v,
      "must be an origin, no path",
    ),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1),
  // Optional: dev has no sending address since #297 (its mail goes to
  // the outbox). Required with Resend or Mailpit, below. Not `z.email()`:
  // local and test senders are `@localhost`, which it refuses.
  RESEND_FROM: optional(
    z.string().regex(/^[^\s@]+@[^\s@]+$/, "must be an email address"),
  ),
  RESEND_FROM_NAME: z.string().min(1),
  // Optional: unset disables the daily cost snapshot.
  CLOUDFLARE_ACCOUNT_ID: optional(
    z.string().regex(/^[0-9a-f]{32}$/, "must be a 32-character hex id"),
  ),

  // Secrets (`.env.example` says what each is for). Optional here;
  // `configurationProblems` requires SESSION_SECRET and Turnstile when
  // deployed. RESEND_API_KEY is optional because the outbox or Mailpit
  // can carry the mail instead (see `email/email-tier.ts`).
  RESEND_API_KEY: optional(z.string().startsWith("re_")),
  SESSION_SECRET: optional(z.string().min(32)),
  TURNSTILE_SECRET_KEY: optional(z.string().min(1)),

  // Site-feedback triage: a fine-grained PAT (Issues read/write) and the
  // "owner/name" repo it files into. Both optional: unset turns the
  // GitHub actions off. Never read on submit.
  SITE_FEEDBACK_GITHUB_TOKEN: optional(z.string().min(1)),
  SITE_FEEDBACK_GITHUB_REPO: optional(
    z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/name"'),
  ),

  // Cost/usage snapshots (#268) — read ONLY by the daily cron, never by
  // a route handler. **Account-scoped and read-only across more than
  // billing**: Billing Read for `/billable-usage`, plus Workers Scripts
  // Read, D1 Read and Workers KV Storage Read for their GraphQL
  // datasets (Account Analytics Read does NOT cover them). It reads
  // telemetry for the WHOLE account, which is why it lives on the cron
  // path only. **Adding a scope widens a credential the whole account
  // is exposed to** — weigh it like a permission grant.
  CLOUDFLARE_ACCOUNT_READ_TOKEN: optional(z.string().min(1)),

  // Local development only: the Mailpit sidecar, e.g.
  // "http://mailpit:8025". See docker-compose.yml.
  MAILPIT_URL: optional(z.url({ protocol: /^https?$/ })),

  // Dev only — the email outbox (#297, docs/adr/0001-dev-email-outbox.md).
  // Written by `sync-env` from the dev stack's outputs; infra refuses
  // `emailOutbox` on prod. The page verifies Cloudflare Access's token
  // itself: issuer `https://${ACCESS_TEAM_DOMAIN}`, audience
  // ACCESS_OUTBOX_AUD.
  EMAIL_OUTBOX: optional(z.literal("1")),
  ACCESS_TEAM_DOMAIN: optional(
    z
      .string()
      .regex(
        /^[a-z0-9-]+\.cloudflareaccess\.com$/,
        "must be <team>.cloudflareaccess.com, no scheme",
      ),
  ),
  ACCESS_OUTBOX_AUD: optional(z.string().min(1)),

  // LOG_LEVEL is deliberately absent. The logger reads it raw, because
  // it has to work while this validation is failing, and treats anything
  // unrecognised as "info". Validating it here would let a typo while
  // turning on debug logging for an incident take the whole site down.

  // E2e only: "1" makes the rate limiters fail open, because the
  // Playwright suite would otherwise trip the 10 req/60 s budget on a
  // reused dev server. Refused on https below.
  E2E_BYPASS_RATE_LIMIT: optional(z.literal("1")),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Thrown for an invalid env. Its message names variables, never values. */
export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid Worker configuration:\n  ${problems.join("\n  ")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/**
 * The schema layer alone. Issues are reduced to `NAME: message` — Zod's
 * own messages for a failed `startsWith` or `literal` can quote what was
 * expected, but never what was received.
 */
export function parseServerEnv(source: Readonly<Record<string, unknown>>) {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) {
    return { ok: true as const, env: result.data };
  }
  return {
    ok: false as const,
    problems: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`,
    ),
  };
}

/**
 * Settings that are valid one by one but wrong together. "Deployed"
 * means APP_BASE_URL is https — the same test the cookie Secure flag
 * uses.
 *
 * Deliberately NOT a problem: EMAIL_OUTBOX with RESEND_API_KEY. Deploys
 * only ever add secrets, so a dev Worker can hold a stale Resend key,
 * and `emailTier()` makes the outbox win over it on purpose (ADR 0001).
 * Refusing the pair would take dev down for the safeguard working.
 */
export function configurationProblems(
  env: ServerEnv,
  client: { VITE_TURNSTILE_SITE_KEY?: string },
): string[] {
  const problems: string[] = [];
  const deployed = env.APP_BASE_URL.startsWith("https://");

  // A passkey's RP ID must be the page's host or a registrable suffix of
  // it, or every registration and sign-in ceremony is refused.
  const host = new URL(env.APP_BASE_URL).hostname;
  if (host !== env.WEBAUTHN_RP_ID && !host.endsWith(`.${env.WEBAUTHN_RP_ID}`)) {
    problems.push(
      "WEBAUTHN_RP_ID must be APP_BASE_URL's host or a parent domain of it.",
    );
  }

  // The outbox without Access's settings, or a deployed Worker with no
  // provider at all, would accept every request and fail the first
  // sign-in. Locally, no provider is allowed: `sendEmail` throws then.
  const tier = emailTier(env);
  if (tier.tier === "none" && (deployed || env.EMAIL_OUTBOX)) {
    problems.push(`Email: ${tier.reason}.`);
  }
  if ((tier.tier === "resend" || tier.tier === "mailpit") && !env.RESEND_FROM) {
    problems.push(`RESEND_FROM is required for the ${tier.tier} tier.`);
  }

  // A secret without a site key means the form never sends a token, so
  // every sign-in is refused; a site key without a secret means the
  // widget is shown and its answer never checked.
  const siteKey = Boolean(client.VITE_TURNSTILE_SITE_KEY);
  const secretKey = Boolean(env.TURNSTILE_SECRET_KEY);
  if (siteKey !== secretKey) {
    problems.push(
      "Set VITE_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY together, or neither.",
    );
  } else if (deployed && !secretKey) {
    problems.push(
      "VITE_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required when deployed.",
    );
  }

  if (deployed) {
    // Locally a missing secret still boots; signing a cookie throws.
    if (!env.SESSION_SECRET) {
      problems.push("SESSION_SECRET is required when deployed.");
    }
    if (env.MAILPIT_URL) {
      problems.push("MAILPIT_URL is for local development only.");
    }
    if (env.E2E_BYPASS_RATE_LIMIT) {
      problems.push("E2E_BYPASS_RATE_LIMIT must never be set when deployed.");
    }
  }

  return problems;
}

const cache: { env?: ServerEnv } = {};

/**
 * The validated vars and secrets. Throws `EnvValidationError` if either
 * layer fails; a failure is not cached, so the error repeats on every
 * call rather than turning into `undefined` reads.
 *
 * Call it inside a handler, never at module scope (the AGENTS.md
 * binding invariant applies: `cloudflare:workers` is stubbed off SSR).
 */
export function serverEnv(): ServerEnv {
  if (cache.env) {
    return cache.env;
  }
  const parsed = parseServerEnv(
    workerEnv as unknown as Record<string, unknown>,
  );
  if (!parsed.ok) {
    throw new EnvValidationError(parsed.problems);
  }
  const problems = configurationProblems(parsed.env, clientEnv);
  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  cache.env = parsed.env;
  return parsed.env;
}

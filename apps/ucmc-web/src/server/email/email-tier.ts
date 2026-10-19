/**
 * Which provider `sendEmail` uses, decided in one place so the sender
 * and `/health` cannot disagree about it. Pure — the env is a parameter
 * — so the order is testable without a Worker.
 *
 * 1. **Outbox** (`EMAIL_OUTBOX` set) — a deployed dev Worker stores the
 *    message in D1 for `/dev/outbox` instead of sending it (#297,
 *    docs/adr/0001-dev-email-outbox.md). It beats Resend on purpose: a
 *    Worker secret outlives the deploy that stopped setting it, so a
 *    stale `RESEND_API_KEY` on dev must not quietly put real mail back
 *    on the wire. Mailpit still wins when both are set, so local
 *    development is unchanged.
 * 2. **Resend** (`RESEND_API_KEY` set) — production.
 * 3. **Mailpit** (`MAILPIT_URL` set) — the local dev sidecar.
 *
 * Anything else is `none`, and `sendEmail` throws. **There is no
 * console tier** and must not be one: logging the message either puts
 * working sign-in links in dashboard-readable Workers Logs or leaves a
 * member waiting for an email that never comes. The outbox is not that
 * tier — it is readable only through Cloudflare Access, and only on
 * dev.
 *
 * The outbox needs the Access settings the page verifies tokens
 * against. Without them nobody could read it, so `EMAIL_OUTBOX` alone is
 * a misconfiguration and is refused here rather than accepted into a
 * table nobody can open.
 */
export interface EmailTierEnv {
  RESEND_API_KEY?: string;
  MAILPIT_URL?: string;
  EMAIL_OUTBOX?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_OUTBOX_AUD?: string;
}

export type EmailTier =
  | { tier: "outbox" }
  | { tier: "resend" }
  | { tier: "mailpit" }
  | { tier: "none"; reason: string };

export function emailTier(env: EmailTierEnv): EmailTier {
  if (env.EMAIL_OUTBOX) {
    if (env.MAILPIT_URL) {
      return { tier: "mailpit" };
    }
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_OUTBOX_AUD) {
      return {
        tier: "none",
        reason:
          "EMAIL_OUTBOX needs ACCESS_TEAM_DOMAIN and ACCESS_OUTBOX_AUD, " +
          "or nobody could read the outbox",
      };
    }
    return { tier: "outbox" };
  }
  if (env.RESEND_API_KEY) {
    return { tier: "resend" };
  }
  if (env.MAILPIT_URL) {
    return { tier: "mailpit" };
  }
  return {
    tier: "none",
    reason:
      "no email provider configured (set RESEND_API_KEY, MAILPIT_URL " +
      "or, on dev, EMAIL_OUTBOX)",
  };
}

/** Where a dev Worker's outbox is read. Kept beside the tier it serves. */
export const DEV_OUTBOX_PATH = "/dev/outbox";

/**
 * The outbox page's path when this Worker's mail goes there, else null.
 *
 * Sent to the client after a send so the "check your email" message can
 * link straight to where the email actually is — on dev only, because
 * it is null everywhere the tier isn't `outbox`, prod above all.
 *
 * **It depends on the environment and nothing else**, which is what
 * keeps it safe to return from the enumeration-proof sign-in request:
 * a known address, an unknown one and a rate-limited one all get the
 * same answer.
 */
export function devOutboxHref(env: EmailTierEnv): string | null {
  return emailTier(env).tier === "outbox" ? DEV_OUTBOX_PATH : null;
}

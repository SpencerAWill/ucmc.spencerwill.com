/**
 * Email sender with two configurable providers and a hard-fail
 * fallback:
 *
 * 1. **Resend** (`RESEND_API_KEY` set) — production path. Posts to the
 *    Resend transactional-email API.
 * 2. **Mailpit** (`MAILPIT_URL` set, `RESEND_API_KEY` absent) — dev
 *    sidecar path. Posts to the Mailpit HTTP send API so emails land in
 *    a real inbox UI at http://localhost:8025. Playwright e2e tests poll
 *    the same API to retrieve magic-link tokens.
 *
 * If neither is configured, `sendEmail` THROWS rather than silently
 * succeeding. An earlier revision logged the email to the Worker
 * console as a "fallback", but that approach has two failure modes
 * — it either dumps magic-link URLs (auth material) into Workers
 * Logs where anyone with dashboard access can extract them within
 * the 15-minute TTL, or it suppresses the body and leaves users
 * staring at a never-arriving email. The right behavior is to fail
 * loudly so an operator notices the misconfiguration and the user
 * sees an error rather than a phantom success.
 */
import { env } from "#/server/cloudflare-env";
import type { EmailKind } from "#/server/email/email-kinds";
import { recordEmailSend } from "#/server/email/email-send-log.server";
import { redactString } from "#/server/log/redact.server";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email provider not configured. Set RESEND_API_KEY (production) " +
        "or MAILPIT_URL (development) so magic-link emails actually go out.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export interface EmailMessage {
  /**
   * What this email IS, for the usage rollup (#268). Set by the template
   * functions below rather than at the call site, so a new send cannot
   * reach a provider uncounted.
   */
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Extra MIME headers. Today this carries `List-Unsubscribe` on
   * courtesy mail only.
   *
   * **Not on transactional or relationship mail.** RFC 8058 one-click
   * unsubscribe binds bulk senders (5,000+/day to Gmail) on marketing
   * and subscribed messages and explicitly excludes transactional mail;
   * putting an unsubscribe header on a magic link or an overdue-gear
   * notice offers an opt-out that doesn't exist. See
   * `.claude/rules/notifications.md`.
   */
  headers?: Record<string, string>;
  /**
   * Passed to Resend as `Idempotency-Key`, which dedupes identical
   * sends for 24 hours.
   *
   * Belt and braces for the daily reminder cron: the `reminder_stage`
   * column is what stops a second run re-sending, and this is what stops
   * it if that column somehow doesn't get written — a worker evicted
   * between the send and the stage advance, say. Ignored by Mailpit,
   * which has no equivalent.
   */
  idempotencyKey?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  // Tier 1 — Resend (production). Tier 2 — Mailpit (dev sidecar).
  const send = env.RESEND_API_KEY
    ? () => sendViaResend(message)
    : env.MAILPIT_URL
      ? () => sendViaMailpit(message)
      : null;

  if (send) {
    try {
      await send();
    } catch (err) {
      // A rejected send is still a send attempt and still tells us about
      // volume; recording only successes would make our figures
      // disagree with the provider's own count in exactly the months
      // something was wrong.
      await recordEmailSend({ kind: message.kind, ok: false });
      throw err;
    }
    await recordEmailSend({ kind: message.kind, ok: true });
    return;
  }

  // Deliberately NOT recorded: no provider is configured, so nothing was
  // attempted. A misconfiguration is not email volume.

  // No provider — fail loudly. An earlier revision logged a
  // structured-warning placeholder here, but the rest of the system
  // would still mark the magic-link request as successful, leaving
  // the user with a token they can never see. Throwing instead
  // surfaces a 500 to the user and a clear stack trace to the
  // operator. The error message names the env vars so the fix is
  // discoverable from the log line.
  throw new EmailNotConfiguredError();
}

async function sendViaResend(message: EmailMessage): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Resend caps the key at 256 chars and expires it after 24h, which
      // is comfortably longer than the gap between two daily cron ticks.
      ...(message.idempotencyKey
        ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) }
        : {}),
    },
    body: JSON.stringify({
      from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    }),
  });

  if (!res.ok) {
    // Resend's validation error responses echo back the offending
    // request payload (including the `to` address) — running
    // through `redactString` keeps an operator-useful error
    // message without dumping recipient PII into Workers Logs when
    // this throw propagates up as an unhandled rejection.
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${redactString(body)}`);
  }
}

async function sendViaMailpit(message: EmailMessage): Promise<void> {
  const from = { Name: env.RESEND_FROM_NAME, Email: env.RESEND_FROM };

  const res = await fetch(`${env.MAILPIT_URL}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: from,
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html ?? "",
      // Mailpit renders these in its UI, which is how the e2e suite and
      // local dev can see that a courtesy message carries
      // `List-Unsubscribe` and a transactional one doesn't.
      Headers: message.headers,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Mailpit send failed (${res.status}): ${redactString(body)}`,
    );
  }
}

export function magicLinkEmail(args: {
  to: string;
  url: string;
  intent: "register" | "login" | "add_email";
}): EmailMessage {
  const action =
    args.intent === "register"
      ? "finish registering"
      : args.intent === "login"
        ? "sign in"
        : "verify this email";
  const subjectVerb =
    args.intent === "register"
      ? "registration"
      : args.intent === "login"
        ? "sign-in"
        : "email-verification";
  return {
    // Not a notification category: a member cannot switch off the
    // email that signs them in. See `email-kinds.ts`.
    kind: "auth.magic_link",
    to: args.to,
    subject: `Your UCMC ${subjectVerb} link`,
    text: [
      `Click the link below to ${action}. It expires in 15 minutes and can only be used once.`,
      "",
      args.url,
      "",
      "If you didn't request this, you can ignore this email.",
    ].join("\n"),
  };
}

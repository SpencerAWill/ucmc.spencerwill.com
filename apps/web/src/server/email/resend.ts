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
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  // Tier 1 — Resend (production)
  if (env.RESEND_API_KEY) {
    await sendViaResend(message);
    return;
  }

  // Tier 2 — Mailpit (dev sidecar)
  if (env.MAILPIT_URL) {
    await sendViaMailpit(message);
    return;
  }

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
    },
    body: JSON.stringify({
      from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
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
  intent: "register" | "login";
}): EmailMessage {
  const action = args.intent === "register" ? "finish registering" : "sign in";
  const subjectVerb = args.intent === "register" ? "registration" : "sign-in";
  return {
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

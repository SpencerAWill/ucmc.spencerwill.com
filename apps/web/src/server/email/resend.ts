/**
 * Email sender with a three-tier fallback:
 *
 * 1. **Resend** (`RESEND_API_KEY` set) — production path. Posts to the
 *    Resend transactional-email API.
 * 2. **Mailpit** (`MAILPIT_URL` set, `RESEND_API_KEY` absent) — dev
 *    sidecar path. Posts to the Mailpit HTTP send API so emails land in
 *    a real inbox UI at http://localhost:8025. Playwright e2e tests poll
 *    the same API to retrieve magic-link tokens.
 * 3. **Console** (neither set) — minimal fallback. Prints the email to
 *    the Worker console so magic links still appear somewhere.
 */
import { env } from "#/server/cloudflare-env";
import { redactEmail, redactString } from "#/server/log/redact.server";

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

  // Tier 3 — console fallback. This path is only meant to fire when
  // an operator has misconfigured the worker (neither Resend nor
  // Mailpit reachable). It MUST NOT echo the email body — the
  // magic-link URL is the only thing the body of a login email
  // contains, and that URL is auth material with a 15-minute TTL.
  // Workers Logs has ~7-day retention and is readable by anyone
  // with Cloudflare dashboard access, so a body dump here is a
  // takeover-grade leak.
  //
  // Print a structured warning with the subject and a redacted
  // recipient so an operator notices the misconfig and can
  // re-enable a real provider; suppress the body entirely.
  // eslint-disable-next-line no-console
  console.warn("email.console_fallback_no_provider_configured", {
    subject: message.subject,
    to: redactEmail(message.to),
    bodyLength: message.text.length,
    note: "Set RESEND_API_KEY (prod) or MAILPIT_URL (dev) to actually send. Body suppressed for safety — magic-link URLs would otherwise land in Workers Logs.",
  });
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

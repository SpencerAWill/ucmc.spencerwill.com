/**
 * Email sender. Uses Resend when RESEND_API_KEY is set; otherwise logs the
 * message to the Worker console so local dev works without configuring Resend.
 */
import { env } from "#/server/cloudflare-env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log("[email:console] —", message.subject);
    console.log(`  to: ${message.to}`);
    console.log(`  ${message.text.replace(/\n/g, "\n  ")}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${body}`);
  }
}

export function magicLinkEmail(args: {
  to: string;
  url: string;
  intent: "register" | "login";
}): EmailMessage {
  const action = args.intent === "register" ? "finish registering" : "sign in";
  return {
    to: args.to,
    subject: `Your UCMC ${args.intent === "register" ? "registration" : "sign-in"} link`,
    text: [
      `Click the link below to ${action}. It expires in 15 minutes and can only be used once.`,
      "",
      args.url,
      "",
      "If you didn't request this, you can ignore this email.",
    ].join("\n"),
  };
}

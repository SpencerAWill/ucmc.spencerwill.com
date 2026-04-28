import { test as base, expect, request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://mailpit:8025";

export interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  To: { Name: string; Address: string }[];
  Snippet: string;
}

export interface MailpitMessageDetail {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  From: { Name: string; Address: string };
  To: { Name: string; Address: string }[];
}

export interface Mailpit {
  /** Clear every message in the inbox. Called automatically before each test. */
  clear: () => Promise<void>;
  /** Poll until at least one message addressed to `to` arrives. */
  waitForMessage: (to: string, timeoutMs?: number) => Promise<MailpitMessage>;
  /** Fetch the full body (Text + HTML) for a previously-listed message. */
  getMessage: (id: string) => Promise<MailpitMessageDetail>;
  /**
   * Convenience: wait for the next message to `to` and pull the first
   * URL out of its plain-text body. Suitable for magic-link flows where
   * the email contains exactly one actionable link.
   */
  extractFirstLink: (to: string, timeoutMs?: number) => Promise<string>;
}

function buildMailpit(api: APIRequestContext): Mailpit {
  const clear = async (): Promise<void> => {
    const res = await api.delete(`${MAILPIT_URL}/api/v1/messages`);
    if (!res.ok()) {
      throw new Error(
        `mailpit clear failed (${res.status()}): ${await res.text()}`,
      );
    }
  };

  const waitForMessage = async (
    to: string,
    timeoutMs = 10_000,
  ): Promise<MailpitMessage> => {
    const deadline = Date.now() + timeoutMs;
    const query = encodeURIComponent(`to:${to}`);
    while (Date.now() < deadline) {
      const res = await api.get(
        `${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`,
      );
      if (res.ok()) {
        const json = (await res.json()) as { messages: MailpitMessage[] };
        if (json.messages.length > 0) {
          return json.messages[0];
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`mailpit: no message to ${to} within ${timeoutMs}ms`);
  };

  const getMessage = async (id: string): Promise<MailpitMessageDetail> => {
    const res = await api.get(`${MAILPIT_URL}/api/v1/message/${id}`);
    if (!res.ok()) {
      throw new Error(
        `mailpit getMessage failed (${res.status()}): ${await res.text()}`,
      );
    }
    return (await res.json()) as MailpitMessageDetail;
  };

  const extractFirstLink = async (
    to: string,
    timeoutMs?: number,
  ): Promise<string> => {
    const summary = await waitForMessage(to, timeoutMs);
    const detail = await getMessage(summary.ID);
    const match = /https?:\/\/\S+/.exec(detail.Text);
    if (!match) {
      throw new Error(
        `mailpit: no URL in message ${summary.ID} (subject: ${summary.Subject})`,
      );
    }
    return match[0];
  };

  return { clear, waitForMessage, getMessage, extractFirstLink };
}

/**
 * Test fixture that gives every spec a fresh Mailpit handle and clears the
 * inbox before each test so per-test message addressing isn't ambiguous.
 *
 * Usage:
 *   import { test } from "../fixtures/mailpit";
 *   test("...", async ({ page, mailpit }) => { ... });
 */
export const test = base.extend<{ mailpit: Mailpit }>({
  mailpit: async ({ playwright: _ }, use) => {
    const api = await request.newContext();
    const mailpit = buildMailpit(api);
    await mailpit.clear();
    await use(mailpit);
    await api.dispose();
  },
});

export { expect };

/**
 * The dev email outbox (#297, docs/adr/0001-dev-email-outbox.md): where
 * a deployed dev Worker's email goes instead of an inbox. `/dev/outbox`
 * lists it, behind Cloudflare Access.
 *
 * Rows hold real recipients and working sign-in links, so they are kept
 * for a day only. Magic links expire long before that; the day exists so
 * a reminder sent by this morning's cron is still there to read this
 * afternoon. `listOutbox` prunes on every read, and the daily retention
 * tick sweeps too, so a dev Worker nobody looks at still forgets.
 */
import { desc, lt } from "drizzle-orm";

import { getDb, schema } from "#/server/db";
import type { EmailMessage } from "#/server/email/resend";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 50;

export interface OutboxEmail {
  id: string;
  kind: string;
  to: string;
  subject: string;
  text: string;
  createdAt: Temporal.Instant;
}

export async function storeInOutbox(
  message: EmailMessage,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<void> {
  await getDb()
    .insert(schema.emailOutbox)
    .values({
      id: crypto.randomUUID(),
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? null,
      createdAt: now,
    });
}

/** Deletes outbox rows older than a day; returns how many went. */
export async function sweepEmailOutbox(
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<number> {
  const cutoff = now.subtract({ milliseconds: RETENTION_MS });
  const deleted = await getDb()
    .delete(schema.emailOutbox)
    .where(lt(schema.emailOutbox.createdAt, cutoff))
    .returning({ id: schema.emailOutbox.id });
  return deleted.length;
}

/** The newest emails, newest first, after pruning old ones. */
export async function listOutbox({
  limit = DEFAULT_LIST_LIMIT,
  now = Temporal.Now.instant(),
}: {
  limit?: number;
  now?: Temporal.Instant;
} = {}): Promise<OutboxEmail[]> {
  await sweepEmailOutbox(now);
  return getDb()
    .select({
      id: schema.emailOutbox.id,
      kind: schema.emailOutbox.kind,
      to: schema.emailOutbox.to,
      subject: schema.emailOutbox.subject,
      text: schema.emailOutbox.text,
      createdAt: schema.emailOutbox.createdAt,
    })
    .from(schema.emailOutbox)
    .orderBy(desc(schema.emailOutbox.createdAt))
    .limit(limit);
}

/**
 * Records that an email went out, for the cost/usage rollup (#268).
 *
 * Resend publishes no usage history — `GET /emails` lists messages and
 * the `x-resend-*-quota` headers are point-in-time — so month-over-month
 * volume has to be ours or it does not exist. `sendEmail()` is the one
 * choke point every send already passes through, which also means the
 * dev Mailpit tier is counted without a special case.
 *
 * **Recording never fails a send.** A member signing in must not be
 * blocked because a telemetry insert lost a race with D1, so every error
 * here is swallowed into a log line. The cost of that is an occasional
 * undercount in a report; the cost of the alternative is a member who
 * cannot sign in.
 *
 * The row carries no recipient — see `0078_email_sends.sql` for why that
 * is load-bearing rather than an oversight.
 */
import type { EmailKind } from "#/server/email/email-kinds";
import { errorMessage, log } from "#/server/log/log.server";

export async function recordEmailSend(args: {
  kind: EmailKind;
  ok: boolean;
  now?: Temporal.Instant;
}): Promise<void> {
  try {
    const { getDb, schema } = await import("#/server/db");
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: crypto.randomUUID(),
        kind: args.kind,
        sentAt: args.now ?? Temporal.Now.instant(),
        ok: args.ok,
      });
  } catch (err) {
    log.warn("email.send_log_failed", {
      kind: args.kind,
      error: errorMessage(err),
    });
  }
}

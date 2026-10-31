/**
 * Conduct emails. Plain text, like every other email here.
 *
 * **No report text goes in any email**: this one says a report is waiting
 * and links to the triage list, which sits behind sign-in and
 * `conduct:view`. Not the reporter, the subject, the date or the body.
 */
import type { EmailMessage } from "#/server/email/resend";

export function conductReportReceivedEmail(args: {
  to: string;
  /** The site origin, e.g. `serverEnv().APP_BASE_URL`. */
  origin: string;
}): EmailMessage {
  const reportsUrl = `${args.origin}/conduct/reports`;
  return {
    kind: "conduct.report_received",
    to: args.to,
    subject: "A new conduct report is waiting",
    text: `A member filed a conduct report. Triage it here: ${reportsUrl}\n`,
  };
}

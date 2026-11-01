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

/** The levels that carry a notice. A note is internal and sends nothing. */
export type ConductNoticeLevel = "warning" | "suspension" | "termination";

export const APPEAL_LINE =
  "You may appeal in writing within two weeks to the Student Activities Board.";

const CORRECTION_LINE =
  "This notice corrects an earlier one. The earlier notice no longer applies.";

/**
 * The formal notice to the member. Plain text: the member statement
 * as the officers wrote it, then the dates and the §9.3 appeal line
 * unless the statement already carries them. A lift notice says only
 * that the sanction was lifted: **the lift reason never goes
 * in an email** (it is in the member's data export). `conduct.notice` is not suppressible, so there is no
 * unsubscribe header.
 *
 * A correction (a record that supersedes an earlier one) says so in its
 * subject and first line, and the earlier record sends no lift notice.
 *
 * The record form's preview calls this too, so what an officer reviews
 * is what is sent.
 */
export function conductNoticeEmail(args: {
  to?: string;
  level: ConductNoticeLevel;
  /** Ignored for a lift notice. */
  statement?: string;
  lifted: boolean;
  /** This notice replaces an earlier one. Ignored for a lift notice. */
  corrects?: boolean;
  startsOn?: Temporal.PlainDate | null;
  endsOn?: Temporal.PlainDate | null;
}): EmailMessage & { subject: string; text: string } {
  const message = {
    kind: "conduct.notice" as const,
    to: args.to ?? "",
  };
  if (args.lifted) {
    return {
      ...message,
      subject: `Your ${args.level} has been lifted`,
      text: `The Executive Committee has lifted the ${args.level} issued to you. It no longer applies to your membership.\n`,
    };
  }
  const statement = (args.statement ?? "").trim();
  const lines = args.corrects ? [CORRECTION_LINE, statement] : [statement];
  const dates: string[] = [];
  for (const [label, date] of [
    ["Starts", args.startsOn],
    ["Ends", args.endsOn],
  ] as const) {
    if (date && !statement.includes(date.toString())) {
      dates.push(`${label}: ${date.toString()}`);
    }
  }
  if (dates.length > 0) {
    lines.push(dates.join("\n"));
  }
  if (!/appeal/i.test(statement)) {
    lines.push(APPEAL_LINE);
  }
  return {
    ...message,
    subject: `${args.corrects ? "Corrected notice" : "Notice"} from the UCMC Executive Committee: ${args.level}`,
    text: `${lines.join("\n\n")}\n`,
  };
}

/**
 * The gear loan reminder messages.
 *
 * Plain text, deliberately. `magicLinkEmail` beside it is plain text,
 * there is no HTML layout in the app, and inventing one is a change that
 * should be made for its own reasons rather than smuggled in under a
 * cron job.
 *
 * **One message per member per category, listing every affected loan.**
 * Sending per loan means a member holding four overdue items gets four
 * emails, which is how a reminder system teaches people to filter it.
 *
 * **The unsubscribe link is on the courtesy message only.** The overdue
 * notice is a relationship message about club property the member is
 * holding — there is no opt-out to offer, so offering one would be a
 * lie. See `.claude/rules/notifications.md`.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import type { LoanReminderStage } from "#/features/gear/lib/loan-reminders";
import type { EmailMessage } from "#/server/email/resend";

export interface ReminderLoanLine {
  /** "Petzl Corax (CH93)", or "6 × Black Diamond HotForge" when counted. */
  gearLabel: string;
  dueAt: Temporal.Instant;
}

/** Due dates read as calendar days, so they render in club time. */
function formatDueDate(dueAt: Temporal.Instant): string {
  return dueAt
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDate()
    .toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
}

function lineFor(loan: ReminderLoanLine): string {
  return `  • ${loan.gearLabel} — due ${formatDueDate(loan.dueAt)}`;
}

export function gearReminderEmail(args: {
  to: string;
  preferredName: string | null;
  /** The highest rung reached across the loans listed. */
  stage: Exclude<LoanReminderStage, "none">;
  loans: ReminderLoanLine[];
  /** Absolute URL of `/my/gear`. */
  myGearUrl: string;
  /** Absolute URL of `/my/preferences`. */
  preferencesUrl: string;
}): EmailMessage {
  const greeting = args.preferredName ? `Hi ${args.preferredName},` : "Hi,";
  const plural = args.loans.length === 1 ? "this" : "these";
  const items = args.loans.map(lineFor).join("\n");

  if (args.stage === "due_soon") {
    return {
      to: args.to,
      subject:
        args.loans.length === 1
          ? "Club gear due back soon"
          : `${args.loans.length} pieces of club gear due back soon`,
      text: [
        greeting,
        "",
        `A heads-up that ${plural} is due back at the gear cave soon:`,
        "",
        items,
        "",
        `You can see everything you have out at ${args.myGearUrl}`,
        "",
        "Bring it by the cave during open hours and an officer will check it in.",
        "",
        "— UCMC",
        "",
        `Don't want these reminders? Turn them off at ${args.preferencesUrl}`,
      ].join("\n"),
      // Courtesy mail, so it carries the header — pointing at the
      // preferences tab, which needs a sign-in. Deliberately NOT an
      // RFC 8058 one-click endpoint: that binds bulk senders (5,000+/day
      // to Gmail), and honouring it would mean a tokened public POST
      // route — a lot of unauthenticated surface for a club sending a
      // few dozen of these a week.
      headers: {
        "List-Unsubscribe": `<${args.preferencesUrl}>`,
      },
    };
  }

  // The three overdue rungs share a body and differ in what they warn
  // about, because the escalation IS the message — "you are now blocked"
  // is the only version that tells a member something they can act on
  // before they turn up at the desk.
  const consequence =
    args.stage === "blocked"
      ? "Because of this, you can't check out any more club gear until it comes back."
      : args.stage === "flagged"
        ? "Officers will see this flagged on your account at the desk. If it stays out, you'll stop being able to borrow."
        : "Please bring it back to the cave during open hours.";

  return {
    to: args.to,
    subject:
      args.stage === "blocked"
        ? "Overdue club gear — you can't borrow until it's returned"
        : args.loans.length === 1
          ? "Club gear is overdue"
          : `${args.loans.length} pieces of club gear are overdue`,
    text: [
      greeting,
      "",
      `Our records show ${plural} is still out and past due:`,
      "",
      items,
      "",
      consequence,
      "",
      `You can see everything you have out at ${args.myGearUrl}`,
      "",
      "If you've already returned it, or something here looks wrong, reply to this email and we'll sort it out.",
      "",
      "— UCMC",
    ].join("\n"),
    // No List-Unsubscribe: there is no opt-out to offer.
  };
}

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
import { categoryForStage } from "#/features/gear/lib/loan-reminders";
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
  /**
   * `gear.caveHoursNote`, or empty to omit the line.
   *
   * **The most useful sentence in the message.** The cave is open about
   * two hours a week, so "bring it back during open hours" without
   * naming them is an instruction a member cannot follow — and it is
   * what makes the day-one overdue notice worth sending at all, given
   * the next chance to return anything may be six days away.
   */
  caveHours: string;
}): EmailMessage {
  const greeting = args.preferredName ? `Hi ${args.preferredName},` : "Hi,";
  const plural = args.loans.length === 1 ? "this" : "these";
  const items = args.loans.map(lineFor).join("\n");
  // Blank collapses the line AND its separator rather than leaving a
  // gap — officers empty this over the summer.
  const hoursBlock =
    args.caveHours.trim().length > 0
      ? [`Cave hours: ${args.caveHours.trim()}`, ""]
      : [];

  if (args.stage === "due_soon") {
    return {
      kind: categoryForStage(args.stage),
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
        "Bring it by and an officer will check it in.",
        "",
        ...hoursBlock,
        `You can see everything you have out at ${args.myGearUrl}`,
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
        : "Please bring it back at the next cave hours.";

  return {
    // Reuses `categoryForStage` rather than re-deriving the mapping:
    // the rollup's buckets and the preference check must name the same
    // category, or a report attributes volume to a category members
    // were never asked about.
    kind: categoryForStage(args.stage),
    to: args.to,
    // Every rung gets its own subject. The flagged one used to reuse the
    // plain overdue wording, so the escalation was invisible from the
    // inbox list — two apparently identical emails a week apart, and the
    // one that actually changed something looked like a repeat.
    subject:
      args.stage === "blocked"
        ? "Overdue club gear — you can't borrow until it's returned"
        : args.stage === "flagged"
          ? "Overdue club gear — your account is now flagged"
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
      ...hoursBlock,
      `You can see everything you have out at ${args.myGearUrl}`,
      "",
      "If you've already returned it, or something here looks wrong, reply to this email and we'll sort it out.",
      "",
      "— UCMC",
    ].join("\n"),
    // No List-Unsubscribe: there is no opt-out to offer.
  };
}

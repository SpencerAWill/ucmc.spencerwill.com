/**
 * Pure formatting for the GitHub text site-feedback triage sends. No I/O.
 *
 * Members are attributed by `users.publicId` only, never name or email.
 */
import type { SiteFeedbackKind } from "#/features/site-feedback/server/limits";

import { CLUB_TIME_ZONE } from "#/config/time";

/** Headroom under GitHub's 65,536-character body limit. */
export const GITHUB_BODY_LIMIT = 65_000;

const USER_AGENT_MAX = 120;

// Same shape as `redact.server`'s pattern, which isn't exported (and this
// module stays free of server-only imports).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ZWSP = "\u200B";

/**
 * Make member free text inert before it is prefilled into GitHub text:
 * emails are removed, `@name` and `#123` get a zero-width space so GitHub
 * neither mentions nor cross-links, and `<` is escaped so a body can't close
 * the `<details>` block. The maintainer can still edit any of it back.
 */
function defuse(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replaceAll("<", "&lt;")
    .replace(/@(?=\w)/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`);
}

const KIND_EMOJI: Record<SiteFeedbackKind, string> = {
  bug: "🐞",
  feature: "✨",
  general: "💬",
};

export function issueMarker(issueId: string): string {
  return `<!-- ucmc:${issueId} -->`;
}

function pathnameOf(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return null;
  }
}

export function quotedReportFor(s: {
  kind: SiteFeedbackKind;
  title: string;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
  createdByPublicId: string | null;
  createdAt: Temporal.Instant;
}): string {
  const date = s.createdAt
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDate()
    .toString();
  const member = s.createdByPublicId ?? "(deleted)";
  const lines = [
    `<details><summary>${KIND_EMOJI[s.kind]} ${defuse(s.title)}: member ${member}, ${date}</summary>`,
    "",
    defuse(s.body),
    "",
  ];

  const parts: string[] = [];
  const pathname = s.pageUrl === null ? null : pathnameOf(s.pageUrl);
  if (pathname !== null) {
    parts.push(`**Page:** \`${pathname}\``);
  }
  if (s.userAgent !== null) {
    const ua =
      s.userAgent.length > USER_AGENT_MAX
        ? `${s.userAgent.slice(0, USER_AGENT_MAX)}…`
        : s.userAgent;
    parts.push(`**Browser:** ${defuse(ua)}`);
  }
  if (parts.length > 0) {
    lines.push(parts.join(" · "), "");
  }
  lines.push("</details>");
  return lines.join("\n");
}

export function composeIssueBody(input: {
  issueId: string;
  summaryMd: string;
  reports: readonly string[];
}): string {
  return `${input.summaryMd}\n\n## Reports (${input.reports.length})\n\n${input.reports.join("\n\n")}\n\n---\n_Collected from UCMC site feedback. Reports are attributed by opaque member id only._\n${issueMarker(input.issueId)}`;
}

export function composeReportsComment(reports: readonly string[]): string {
  return `## More reports (${reports.length})\n\n${reports.join("\n\n")}\n\n---\n_Linked from UCMC site-feedback triage._`;
}

export function defaultLabelsFor(kinds: readonly SiteFeedbackKind[]): string[] {
  const labels: string[] = [];
  if (kinds.includes("bug")) {
    labels.push("bug");
  }
  if (kinds.includes("feature")) {
    labels.push("enhancement");
  }
  labels.push("feedback");
  return labels;
}

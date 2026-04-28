/**
 * Best-effort mirror of a feedback submission to a GitHub issue.
 *
 * Patterned on the Turnstile verifier (`features/auth/server/turnstile.server`):
 *  - Reads `GITHUB_FEEDBACK_TOKEN` and `GITHUB_FEEDBACK_REPO` from the
 *    Worker env. Both optional — when either is unset, the call is a
 *    no-op (returns null) so local dev and any environment that opts
 *    out of the mirror still works unchanged.
 *  - Fails open on every error path. The user's submission has already
 *    been written to D1; if GitHub is down or the token is wrong, we
 *    swallow the failure and return null. Surfacing a GitHub error to
 *    the user would be misleading — their feedback IS saved.
 *
 * No PII (email, full name) is included in the issue body. The
 * submitter is referenced only by their `users.publicId`, which is the
 * non-enumerable opaque id already used in `/members/<publicId>` URLs.
 * Admins look up the actual member via the in-app triage view.
 */
import { env } from "#/server/cloudflare-env";
import type { FeedbackKind } from "#/features/feedback/server/limits";

const KIND_LABELS: Record<FeedbackKind, string[]> = {
  bug: ["bug", "feedback"],
  feature: ["enhancement", "feedback"],
  general: ["feedback"],
  question: ["question", "feedback"],
};

export async function mirrorToGithub(input: {
  kind: FeedbackKind;
  title: string;
  body: string;
  submitterPublicId: string | null;
  pageUrl: string | null;
}): Promise<{ number: number; url: string } | null> {
  const token = env.GITHUB_FEEDBACK_TOKEN;
  const repo = env.GITHUB_FEEDBACK_REPO;
  if (!token || !repo) {
    return null;
  }
  try {
    const submitter = input.submitterPublicId ?? "unknown";
    const pageLine = input.pageUrl
      ? `\n\n**Submitted from:** \`${input.pageUrl}\``
      : "";
    const issueBody = `${input.body}${pageLine}\n\n---\n_Submitted via UCMC web by member \`${submitter}\`._`;
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ucmc-web-feedback",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `[${input.kind}] ${input.title}`,
        body: issueBody,
        labels: KIND_LABELS[input.kind],
      }),
    });
    if (!res.ok) {
      console.error(
        `[feedback] GitHub mirror returned ${res.status}: ${await res.text().catch(() => "<unreadable>")}`,
      );
      return null;
    }
    const json: unknown = await res.json();
    if (
      !json ||
      typeof json !== "object" ||
      !("number" in json) ||
      !("html_url" in json) ||
      typeof json.number !== "number" ||
      typeof json.html_url !== "string"
    ) {
      return null;
    }
    return { number: json.number, url: json.html_url };
  } catch (err) {
    console.error("[feedback] GitHub mirror threw", err);
    return null;
  }
}

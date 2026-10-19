/**
 * `/dev/outbox`: the email a deployed dev Worker stored instead of
 * sending (#297, docs/adr/0001-dev-email-outbox.md).
 *
 * Two locks. A Cloudflare Access application in front of the path lets
 * only the dev stack's `outboxViewers` through; and this handler
 * verifies the token Access attaches (`Cf-Access-Jwt-Assertion`) itself:
 * its signature against the team's published keys, its issuer, its
 * audience (that application's tag) and its expiry. So a deleted or
 * loosened Access policy, or a request that reaches the Worker another
 * way — its `workers.dev` hostname, which no Access application covers —
 * still gets a 403.
 *
 * The header, not the `CF_Authorization` cookie: Cloudflare documents
 * the cookie as not guaranteed to be passed to the origin.
 *
 * A plain HTML response rather than a React route on purpose. It holds
 * working sign-in links, so it carries no app chrome, no client bundle,
 * no session and no query cache — nothing that could put a link
 * somewhere other than this one response.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

import { CLUB_TIME_ZONE } from "#/config/time";
import { OUTBOX_LIST_LIMIT } from "#/server/email/outbox.server";
import type { OutboxEmail } from "#/server/email/outbox.server";
import { log } from "#/server/log/log.server";

export interface OutboxSettings {
  enabled: boolean;
  /** `<team>.cloudflareaccess.com` */
  teamDomain: string | undefined;
  /** The outbox Access application's audience tag. */
  aud: string | undefined;
  /** Links to this origin (sign-in links) are made clickable; no others. */
  appBaseUrl: string;
}

// One key set per team domain, cached for the isolate's life. jose
// refetches when it meets a `kid` it doesn't hold, which is how Access's
// six-weekly key rotation is picked up. Built lazily because the domain
// comes from `env`, which must not be read at module scope.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(teamDomain: string) {
  const cached = keySets.get(teamDomain);
  if (cached) {
    return cached;
  }
  const created = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  );
  keySets.set(teamDomain, created);
  return created;
}

/**
 * The email Access says is asking, or null when the token is missing,
 * invalid, or carries no email.
 *
 * **A token without an email is refused**, though Access would sign one
 * for a service token. Nothing here uses service tokens, and accepting
 * them would let a service-token rule added to the Access policy later
 * open this page without anyone deciding it should.
 */
export async function accessViewer(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<string | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, keySet(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    return typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;
  } catch {
    return null;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export async function handleOutbox(
  request: Request,
  settings: OutboxSettings,
  list: () => Promise<OutboxEmail[]>,
): Promise<Response> {
  // With the outbox off the page does not exist — on prod above all.
  if (!settings.enabled || !settings.teamDomain || !settings.aud) {
    return notFound();
  }
  const viewer = await accessViewer(request, settings.teamDomain, settings.aud);
  if (!viewer) {
    log.warn("outbox.access_denied", {});
    return new Response("Forbidden", { status: 403 });
  }
  const emails = await list();
  return new Response(renderOutbox(emails, settings.appBaseUrl), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Working sign-in links: never cached, indexed, or sent onward as
      // a referrer.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A URL in running text. Captured, so `split` keeps it; the last
 * character can't be sentence punctuation, so "…?token=abc." links to
 * the token rather than to a broken copy of it.
 */
const URL_IN_TEXT = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/;

/**
 * The text, escaped, with links to `origin` made clickable. Any other
 * URL stays text: a message body is whatever a template produced, and
 * this page must not become a way to click through to somewhere else
 * while signed in to Access.
 */
export function linkify(text: string, origin: string): string {
  const own = new URL(origin).origin;
  // `split` on a capturing pattern alternates text and URL: the odd
  // indices are the URLs.
  return text
    .split(URL_IN_TEXT)
    .map((part, index) =>
      index % 2 === 1 && isSameOrigin(part, own)
        ? `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>`
        : escapeHtml(part),
    )
    .join("");
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** `2026-10-18 08:00:00 EDT`-ish, in the club's zone like the rest of the app. */
function formatSentAt(instant: Temporal.Instant): string {
  const zoned = instant.toZonedDateTimeISO(CLUB_TIME_ZONE);
  const local = zoned
    .toPlainDateTime()
    .toString({ smallestUnit: "second" })
    .replace("T", " ");
  return `${local} ${zoned.offset}`;
}

export function renderOutbox(
  emails: OutboxEmail[],
  appBaseUrl: string,
  limit: number = OUTBOX_LIST_LIMIT,
): string {
  // A full page may be a truncated one. Saying so is the difference
  // between "that reminder was never sent" and "scroll limit reached".
  const truncated =
    emails.length >= limit
      ? `<p class="meta">Showing the newest ${limit}; older messages from the last day are not listed.</p>`
      : "";
  const items = emails
    .map(
      (e) => `<article>
  <h2>${escapeHtml(e.subject)}</h2>
  <p class="meta">To ${escapeHtml(e.to)} · ${escapeHtml(e.kind)} · <time datetime="${e.createdAt.toString()}">${formatSentAt(e.createdAt)}</time></p>
  <pre>${linkify(e.text, appBaseUrl)}</pre>
</article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Dev outbox</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  article { border-top: 1px solid #8884; padding: 1rem 0; }
  h2 { font-size: 1.1rem; margin: 0; }
  .meta { opacity: 0.75; margin: 0.25rem 0; font-size: 0.9rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
</head>
<body>
<h1>Dev outbox</h1>
<p>Email this dev environment would have sent, newest first. Kept for a day.</p>
${truncated}
${items || "<p>Nothing yet.</p>"}
</body>
</html>`;
}

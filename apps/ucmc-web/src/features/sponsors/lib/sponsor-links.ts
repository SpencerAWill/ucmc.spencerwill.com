import { HTTP_SCHEME } from "#/features/sponsors/server/sponsor-schemas";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";

/**
 * Where a sponsor card's name links, or `null` for no link at all.
 *
 * The scheme is re-checked here rather than trusting the stored value.
 * The schema's allowlist only guards writes made after it shipped; a row
 * written before it — or by a direct `wrangler d1 execute` edit — would
 * otherwise put `javascript:` into an `<a href>` on a page anonymous
 * visitors can load. Returning `null` degrades the card to plain text,
 * which is the right failure: the sponsor is still credited.
 *
 * `null` is also the answer for a sponsor with no website on file, so
 * the caller renders text rather than an `href=""` — which resolves as
 * a same-origin reload, worse than no link.
 */
export function sponsorWebsiteHref(sponsor: SponsorEntry): string | null {
  if (sponsor.websiteUrl && HTTP_SCHEME.test(sponsor.websiteUrl)) {
    return sponsor.websiteUrl;
  }
  return null;
}

/**
 * `mailto:` draft for an organization asking about sponsoring the club,
 * pre-loaded with the questions an officer would otherwise have to write
 * back for.
 *
 * A `mailto:` rather than an intake form, for the same reason
 * /volunteer's request band is one: a public unauthenticated write needs
 * its own table, Turnstile, a rate-limit budget and a triage queue —
 * a feedback-sized subsystem for a channel that sees a handful of
 * messages a year.
 *
 * Returns `null` on a blank club email (it's a site setting and may be
 * unset) so the whole band can be omitted rather than rendering a dead
 * button.
 */
export function sponsorInquiryHref(
  clubEmail: string | null | undefined,
): string | null {
  if (!clubEmail || clubEmail.length === 0) {
    return null;
  }
  const subject = encodeURIComponent("Sponsoring UCMC");
  const body = encodeURIComponent(
    [
      "Organization:",
      "Contact name:",
      "Phone:",
      "Website:",
      "",
      "What you'd like to offer (gear discount, product, event support, scholarship giving, something else):",
      "",
      "Anything you'd want from us in return:",
    ].join("\n"),
  );
  return `mailto:${clubEmail}?subject=${subject}&body=${body}`;
}

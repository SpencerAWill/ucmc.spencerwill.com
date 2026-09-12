import { HTTP_SCHEME } from "#/features/volunteer/server/volunteer-schemas";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

/**
 * Where an outing's "Join" affordance points.
 *
 * Member sign-ups are deferred until the trips work settles, so there is
 * no `volunteer_signups` table and nothing to POST to. Until there is,
 * an outing either sends people to the partner organization's own
 * registration form (`signupUrl`) or opens a mail draft to the club
 * address with the outing named in the subject, so the officer reading
 * it knows which one without asking.
 *
 * Returns `null` when neither is available — the club email is a site
 * setting and may be blank — so the caller renders no affordance rather
 * than a dead `href=""`, which would resolve as a same-origin reload.
 */
export function outingJoinHref(
  event: VolunteerEventEntry,
  clubEmail: string | null | undefined,
): { href: string; external: boolean } | null {
  // Re-check the scheme at render time rather than trusting the stored
  // value. The schema's allowlist only guards writes made after it
  // shipped; a row written before it — or by a direct SQL edit — would
  // otherwise put `javascript:` into an `<a href>` on a page anonymous
  // visitors can see. Falling through to the mailto is the right
  // degradation: the outing stays joinable.
  if (event.signupUrl && HTTP_SCHEME.test(event.signupUrl)) {
    return { href: event.signupUrl, external: true };
  }
  if (clubEmail && clubEmail.length > 0) {
    const subject = encodeURIComponent(`Volunteer sign-up: ${event.title}`);
    return { href: `mailto:${clubEmail}?subject=${subject}`, external: false };
  }
  return null;
}

/**
 * `mailto:` draft for an outside organization asking the club for
 * volunteers, pre-loaded with the questions an officer would otherwise
 * have to write back for. Returns `null` on a blank club email so the
 * whole band can be omitted.
 */
export function requestVolunteersHref(
  clubEmail: string | null | undefined,
): string | null {
  if (!clubEmail || clubEmail.length === 0) {
    return null;
  }
  const subject = encodeURIComponent("Volunteer request for UCMC");
  const body = encodeURIComponent(
    [
      "Organization:",
      "Contact name:",
      "Phone:",
      "Date(s) you need help:",
      "Location:",
      "How many volunteers:",
      "What the work involves:",
      "",
      "Anything else we should know:",
    ].join("\n"),
  );
  return `mailto:${clubEmail}?subject=${subject}&body=${body}`;
}

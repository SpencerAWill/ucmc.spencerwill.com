import { Mail } from "lucide-react";

import { MarkdownContent } from "#/components/markdown/markdown-content";
import { Button } from "#/components/ui/button";
import { sponsorInquiryHref } from "#/features/sponsors/lib/sponsor-links";

/**
 * The band a prospective sponsor came for: the pitch, and a way to ask.
 *
 * The copy is officer-editable markdown (`markdown_pages` slug
 * `sponsors_pitch`) rather than hardcoded, because what the club can
 * offer a sponsor changes with the exec board and shouldn't need a
 * deploy. The button is a `mailto:` for the same reason /volunteer's
 * request band is one — a public unauthenticated write is a
 * feedback-sized subsystem for a handful of messages a year.
 *
 * The *button* is dropped when the club email setting is blank (an
 * `href=""` resolves as a same-origin reload, worse than no button), but
 * the pitch still renders: the case for sponsoring is worth reading even
 * when the address to reply to is momentarily unset, and a manager can
 * see their copy on the page while they go set it.
 */
export function BecomeASponsor({
  markdown,
  clubEmail,
}: {
  markdown: string;
  clubEmail?: string | null;
}) {
  const href = sponsorInquiryHref(clubEmail);
  if (markdown.length === 0 && !href) {
    return null;
  }
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-5">
      {markdown.length > 0 ? (
        <MarkdownContent>{markdown}</MarkdownContent>
      ) : null}
      {href ? (
        <Button asChild>
          <a href={href}>
            <Mail className="size-4" />
            Get in touch
          </a>
        </Button>
      ) : null}
    </section>
  );
}

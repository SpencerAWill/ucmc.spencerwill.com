import { Mail } from "lucide-react";

import { Button } from "#/components/ui/button";
import { requestVolunteersHref } from "#/features/volunteer/lib/join-link";

/**
 * The band an outside organization came for: a way to ask.
 *
 * A `mailto:` rather than an intake form — a public unauthenticated
 * write would need its own table, Turnstile, a rate-limit budget and a
 * triage queue, which is a feedback-sized subsystem for a channel that
 * may see a handful of messages a year. The draft is pre-loaded with
 * the questions an officer would otherwise have to write back for.
 *
 * Renders nothing when the club email setting is blank, the same
 * convention `<SocialIconLinks>` uses — an `href=""` would resolve as a
 * same-origin reload, which is worse than no button.
 */
export function RequestVolunteers({
  clubEmail,
}: {
  clubEmail?: string | null;
}) {
  const href = requestVolunteersHref(clubEmail);
  if (!href) {
    return null;
  }
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-5">
      <h2 className="text-lg font-semibold tracking-tight">Need volunteers?</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        If you run a park, a trail crew, a land trust, or anything else that
        could use a group of students for a day, tell us what you need and when.
        We'll write back either way.
      </p>
      <Button asChild>
        <a href={href}>
          <Mail className="size-4" />
          Request volunteers
        </a>
      </Button>
    </section>
  );
}

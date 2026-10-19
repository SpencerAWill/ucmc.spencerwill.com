import { Inbox } from "lucide-react";

/**
 * "Open the dev outbox" — shown under a "check your email" message when
 * the server says the email went to the outbox (#297) rather than to an
 * inbox. The server sends `href` only on a dev Worker with the outbox
 * on; everywhere else it is null and this renders nothing, so prod can't
 * show it whatever the client believes about its environment.
 *
 * A plain anchor, not a router `Link`: `/dev/outbox` is a server route
 * behind Cloudflare Access, not a page in the app's route tree. A new
 * tab keeps the confirmation (and "Use a different email") where it is.
 */
export function DevOutboxLink({ href }: { href: string | null | undefined }) {
  if (!href) {
    return null;
  }
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <Inbox className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Dev environment: email isn&rsquo;t sent.{" "}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          Open the dev outbox
        </a>
      </span>
    </p>
  );
}

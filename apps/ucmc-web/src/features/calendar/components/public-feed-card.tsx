import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  googleCalendarAddUrl,
  publicFeedUrl,
  webcalUrl,
} from "#/features/calendar/lib/feed-url";

/**
 * The anonymous feed of public events.
 *
 * **It exists so members have something to hand a non-member.** A
 * prospective member, a partner org, a parent asking when the trip gets
 * back — none of them have an account, and the personal feed is a
 * bearer credential that must never be forwarded. Without this the
 * public feed was built, routed and tested while being reachable from
 * nowhere in the UI, which is a feature only in the commit log.
 *
 * Deliberately NOT a token: there is nothing to revoke and nothing to
 * leak, because it carries only events an anonymous visitor could see
 * on the site anyway.
 */
export function PublicFeedCard() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Read after mount: there is no `window` on the server, and this page
  // server-renders.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!origin) {
    return null;
  }

  const url = publicFeedUrl(origin);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Public calendar</h3>
        <p className="text-sm text-muted-foreground">
          A version carrying only events we show publicly. Safe to share with
          anyone &mdash; it needs no account and is not tied to you, so it will
          not show members-only events.
        </p>
      </div>

      <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
        {url}
      </code>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={webcalUrl(url)}>Add to Apple Calendar</a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a
            href={googleCalendarAddUrl(url)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink />
            Add to Google Calendar
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(url)
              .then(() => setCopied(true))
              .catch(() =>
                toast.error("Couldn't copy. Select the link above instead."),
              );
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </section>
  );
}

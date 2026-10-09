import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Toggle } from "#/components/ui/toggle";
import type { EventKind } from "#/../drizzle/schema";
import { mySubscriptionsQueryOptions } from "#/features/calendar/api/queries";
import {
  useCreateSubscription,
  useRevokeSubscription,
  useRotateSubscription,
} from "#/features/calendar/api/use-subscription-mutations";
import {
  feedUrl,
  googleCalendarAddUrl,
  publicFeedUrl,
  webcalUrl,
} from "#/features/calendar/lib/feed-url";
import {
  EVENT_KIND_DOT,
  EVENT_KIND_LABEL,
} from "#/features/calendar/lib/event-display";
import { formatRelative } from "#/lib/date-format";
import { cn } from "#/lib/utils";

/**
 * A label for an unnamed link, so the list is readable.
 *
 * A filtered link with no label would otherwise read "Calendar link"
 * beside four others, and the member revoking one has no way to tell
 * which is which — the list deliberately carries no tokens to compare.
 */
function defaultLabelFor(kinds: readonly EventKind[]): string | null {
  if (kinds.length === 0) {
    return null;
  }
  return kinds.map((kind) => EVENT_KIND_LABEL[kind]).join(", ");
}

const KIND_ORDER: readonly EventKind[] = [
  "meeting",
  "trip",
  "social",
  "exec",
  "other",
];

/**
 * Manage the member's calendar subscription links.
 *
 * **A token is shown exactly once, when it is minted.** The list query
 * deliberately carries no tokens, so a member who loses their link
 * rotates rather than re-reads it. That is the right trade for a bearer
 * credential: a URL rendered into every page load ends up in browser
 * caches, screenshots and over shoulders, and this one is as good as a
 * password for reading the club calendar.
 *
 * Three affordances on the fresh link, because no single one works
 * everywhere: `webcal://` is one tap on iOS, macOS and Outlook and
 * inert on Android; the Google deep link covers most of the rest; and
 * copy-to-clipboard covers everything else. Most members have never
 * heard of an .ics URL, so the panel leads with what to do rather than
 * what it is.
 */
export function SubscribePanel() {
  const { data: subscriptions } = useSuspenseQuery(
    mySubscriptionsQueryOptions(),
  );
  const [label, setLabel] = useState("");
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [fresh, setFresh] = useState<{
    token: string;
    kinds: EventKind[];
  } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const createSubscription = useCreateSubscription();
  const revokeSubscription = useRevokeSubscription();
  const rotateSubscription = useRotateSubscription();
  const busy =
    createSubscription.isPending ||
    revokeSubscription.isPending ||
    rotateSubscription.isPending;

  const onError = (err: Error) => toast.error(err.message);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Subscribe to the calendar</h2>
          <p className="text-sm text-muted-foreground">
            Add the club calendar to your phone or laptop once, and club events
            keep showing up on their own. Make a link below, then open it on the
            device you want it on.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subscription-label">
            What&rsquo;s it for? (optional)
          </Label>
          <Input
            id="subscription-label"
            placeholder="iPhone"
            maxLength={60}
            className="w-full sm:w-56"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {/*
         * Which kinds this link carries.
         *
         * **The filter is baked into the URL, not stored.** That is what
         * lets a member subscribe twice from the same account and get
         * trips and meetings as two separately-coloured calendars in
         * their phone, each toggled on its own — which is what people
         * who care about this actually want, and what a single stored
         * preference per member could never give them.
         *
         * Nothing selected means everything, stated in the hint rather
         * than by pre-selecting all five: an empty filter and a
         * fully-selected one produce the same feed, and pre-selecting
         * would imply unticking one is how you narrow it.
         */}
        <div className="space-y-2">
          <Label>What should it include?</Label>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Event types to include"
          >
            {KIND_ORDER.map((kind) => (
              <Toggle
                key={kind}
                size="sm"
                variant="outline"
                pressed={kinds.includes(kind)}
                onPressedChange={(pressed) =>
                  setKinds((prev) =>
                    pressed
                      ? [...prev, kind]
                      : prev.filter((value) => value !== kind),
                  )
                }
                className="h-8 rounded-full px-3 text-xs data-[state=on]:bg-accent"
              >
                <span
                  className={cn("size-2 rounded-full", EVENT_KIND_DOT[kind])}
                  aria-hidden
                />
                {EVENT_KIND_LABEL[kind]}
              </Toggle>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {kinds.length === 0
              ? "Everything on the club calendar. Pick types to make a narrower link \u2014 subscribe more than once to keep them as separate calendars on your phone."
              : `Only ${kinds.map((kind) => EVENT_KIND_LABEL[kind].toLowerCase()).join(", ")} events.`}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              createSubscription.mutate(
                {
                  label:
                    label.trim() === "" ? defaultLabelFor(kinds) : label.trim(),
                },
                {
                  onSuccess: ({ token }) => {
                    // The filter is captured WITH the token rather than
                    // read from state when the link renders: it is baked
                    // into that URL and nothing afterwards can change
                    // it, so showing a link that disagrees with the
                    // chips would be a lie the member only discovers on
                    // their phone a day later.
                    setFresh({ token, kinds });
                    setLabel("");
                    toast.success("Calendar link created.");
                  },
                  onError,
                },
              )
            }
          >
            <Plus />
            Make a link
          </Button>
        </div>
      </section>

      {fresh ? (
        <FreshLink
          token={fresh.token}
          kinds={fresh.kinds}
          onDismiss={() => setFresh(null)}
        />
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Your links
        </h3>

        {subscriptions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            You haven&rsquo;t made a calendar link yet.
          </p>
        ) : (
          // Stacked rows rather than a table: this is a find-one-and-act
          // surface (which link is my old phone's?), not one anybody
          // scans a column of.
          <ul className="space-y-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {subscription.label ?? "Calendar link"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Created {formatRelative(subscription.createdAt)}
                    {" · "}
                    {/* The diagnostic that answers "why is my calendar
                     * stale?" before anyone starts guessing about
                     * caches: is the client polling at all? */}
                    {subscription.lastFetchedAt
                      ? `last used ${formatRelative(subscription.lastFetchedAt)}`
                      : "never used"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      rotateSubscription.mutate(
                        { id: subscription.id },
                        {
                          onSuccess: ({ token }) => {
                            // A replacement keeps the OLD link's shape
                            // only in its label; its filter is not
                            // stored, so the replacement is unfiltered.
                            // Said plainly below rather than guessed at.
                            setFresh({ token, kinds: [] });
                            toast.success(
                              "New link created. The old one stopped working.",
                            );
                          },
                          onError,
                        },
                      )
                    }
                  >
                    <RotateCw />
                    Replace
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setPendingRevoke(subscription.id)}
                  >
                    <Trash2 />
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PublicFeedSection />

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRevoke(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this calendar link?</AlertDialogTitle>
            <AlertDialogDescription>
              Any device using it will stop receiving club events, and the link
              can never be re-enabled. You can make a new one at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRevoke) {
                  return;
                }
                revokeSubscription.mutate(
                  { id: pendingRevoke },
                  {
                    onSuccess: () => {
                      toast.success("Calendar link revoked.");
                      setPendingRevoke(null);
                    },
                    onError,
                  },
                );
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The one and only render of a live token.
 *
 * The origin is read after mount rather than during render: there is no
 * `window` on the server, and this component is inside an authenticated
 * page that server-renders. Holding the URL back for one frame is also
 * what keeps a bearer credential out of the SSR HTML.
 */
function FreshLink({
  token,
  kinds,
  onDismiss,
}: {
  token: string;
  kinds: readonly EventKind[];
  onDismiss: () => void;
}) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const url = feedUrl(origin, token, kinds);

  return (
    <Alert>
      <AlertTitle>Your calendar link is ready</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Open this on the device you want the calendar on. It won&rsquo;t be
          shown again &mdash; if you lose it, use &ldquo;Replace&rdquo; to make
          a new one.
        </p>

        {kinds.length > 0 ? (
          <p className="text-sm">
            This link carries{" "}
            <strong>
              {kinds
                .map((kind) => EVENT_KIND_LABEL[kind].toLowerCase())
                .join(", ")}
            </strong>{" "}
            events only.
          </p>
        ) : null}

        <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
          {url}
        </code>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            {/* One tap on iOS, macOS and Outlook. Inert on Android,
             * which is why it is not the only affordance here. */}
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
                  // Clipboard access can be refused outright (insecure
                  // context, permissions policy). Say so rather than
                  // silently doing nothing — the URL is on screen to
                  // select by hand.
                  toast.error("Couldn't copy. Select the link above instead."),
                );
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Done
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Calendar apps check for new events on their own schedule &mdash;
          Google sometimes only every few hours &mdash; so a brand-new event may
          take a while to appear.
        </p>
      </AlertDescription>
    </Alert>
  );
}

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
function PublicFeedSection() {
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

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
import { mySubscriptionsQueryOptions } from "#/features/calendar/api/queries";
import {
  useCreateSubscription,
  useRevokeSubscription,
  useRotateSubscription,
} from "#/features/calendar/api/use-subscription-mutations";
import {
  feedUrl,
  googleCalendarAddUrl,
  webcalUrl,
} from "#/features/calendar/lib/feed-url";
import { formatRelative } from "#/lib/date-format";

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
  const [freshToken, setFreshToken] = useState<string | null>(null);
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

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="subscription-label">
              What&rsquo;s it for? (optional)
            </Label>
            <Input
              id="subscription-label"
              placeholder="iPhone"
              maxLength={60}
              className="w-56"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              createSubscription.mutate(
                { label: label.trim() === "" ? null : label.trim() },
                {
                  onSuccess: ({ token }) => {
                    setFreshToken(token);
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

      {freshToken ? (
        <FreshLink token={freshToken} onDismiss={() => setFreshToken(null)} />
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
                            setFreshToken(token);
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
  onDismiss,
}: {
  token: string;
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

  const url = feedUrl(origin, token);

  return (
    <Alert>
      <AlertTitle>Your calendar link is ready</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Open this on the device you want the calendar on. It won&rsquo;t be
          shown again &mdash; if you lose it, use &ldquo;Replace&rdquo; to make
          a new one.
        </p>

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

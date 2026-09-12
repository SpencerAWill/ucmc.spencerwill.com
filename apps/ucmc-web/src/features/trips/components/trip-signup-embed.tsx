import { Link } from "@tanstack/react-router";
import { ExternalLink, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";

/**
 * The club's trip sign-up Google Form, embedded in the app.
 *
 * **This is a stopgap.** Trips are being built as a first-class feature
 * (`/trips` with real rows, rosters and waiver gating); until that lands
 * members still need somewhere to sign up, and the club already runs
 * sign-ups through this form. Embedding it keeps the entry point inside
 * the member area — one place to send people — instead of a link in a
 * GroupMe message that nobody can find two weeks later.
 *
 * When the real feature ships, delete this component, the `/trips` route's
 * body, and the `https://docs.google.com` entry in `frame-src`
 * (`server/headers.server.ts`) — that CSP allowance exists only for this.
 */

/**
 * Form URL as Google's "Send > embed" dialog hands it out. `embedded=true`
 * is what strips Google's own page chrome, so it belongs on the iframe
 * `src` and NOT on the new-tab link below — a standalone tab wants the
 * full-page form.
 */
const SIGNUP_FORM_EMBED_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdP1JlNRk-5dkdVOfG8ysNmiLOavpvqdkvdizbRtyxbvnsgog/viewform?embedded=true";

const SIGNUP_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdP1JlNRk-5dkdVOfG8ysNmiLOavpvqdkvdizbRtyxbvnsgog/viewform";

/**
 * Takes `waiverCurrent` as a prop rather than reading the waiver query
 * itself, so the component stays query-free and renders in the dom pool
 * without a QueryClient — the same arrangement `ServiceRecord` uses for
 * `canLinkToAlbum`.
 */
export function TripSignupEmbed({ waiverCurrent }: { waiverCurrent: boolean }) {
  return (
    <div className="space-y-4">
      {/* Advisory, not a gate. `requireCurrentWaiver` would bounce a
       * lapsed member to /my/waiver and leave them unable to sign up at
       * all — but attestation is officer-driven off-platform (a member
       * cannot self-serve it), so hard-gating would strand people who
       * signed their paper and are waiting on the Treasurer. The trip
       * leader still checks standing before anyone leaves. */}
      {waiverCurrent ? null : (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>
            Your waiver isn&rsquo;t on file for this cycle
          </AlertTitle>
          {/* The <p> is load-bearing, not decoration: AlertDescription is
           * a `grid`, so a bare inline <a> among its children becomes a
           * grid item and breaks onto its own row mid-sentence. Wrapping
           * the prose in the <p> the component already styles
           * (`[&_p]:leading-relaxed`) keeps the link inline. */}
          <AlertDescription>
            <p>
              You can still sign up, but you won&rsquo;t be able to come on the
              trip until an officer has your signed paper waiver. See{" "}
              <Link className="underline underline-offset-4" to="/my/waiver">
                your waiver page
              </Link>{" "}
              for how to get attested.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={SIGNUP_FORM_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Open the form in a new tab
          </a>
        </Button>
      </div>

      {/* Bare iframe, no fallback children — same reasoning as the
       * gazette PDF reader: iframe children are a pre-frames legacy
       * mechanism that React serializes during SSR and then hydrates
       * into a mismatch. The new-tab button above is the recovery path
       * when a browser refuses to frame third-party content (strict
       * tracking-protection modes block this one). Height is fixed
       * because the frame is cross-origin: there is no way to read the
       * form's content height, so the iframe scrolls internally. */}
      <div className="overflow-hidden rounded-md border bg-muted/30">
        <iframe
          src={SIGNUP_FORM_EMBED_URL}
          title="Trip sign-up form"
          className="block h-[80vh] min-h-[640px] w-full"
        />
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { passkeyListQueryOptions } from "#/features/auth/api/queries";
import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

/** Per-browser, not per-account: see the dismissal note below. */
const DISMISSED_KEY = "ucmc:passkey-nudge:dismissed";

function readDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    // Private mode / blocked site data. Showing the nudge is the safe
    // failure: it costs a line of page, not a broken profile tab.
    return false;
  }
}

/**
 * Dismissible "add a passkey" nudge on `/my/profile`, shown only to
 * approved members holding zero credentials.
 *
 * The sibling of `PasskeyEnrollmentCard`: that one catches people
 * during the approval wait, this one catches everyone it missed —
 * members who skipped it, and **officer pre-added ("unclaimed")
 * members, who never see `/register/pending` at all** because pre-add
 * is itself the approval signal. Profile rather than Security because
 * the point is to reach someone who was not already looking for
 * passkeys; a nudge on the page that already offers enrollment is just
 * a second copy of the button.
 *
 * **Dismissal is per-browser (`localStorage`), deliberately.** A
 * server-side flag would need a migration and a mutation to remember
 * one "no thanks" about a thing that already self-retires the moment a
 * credential exists, and per-browser is arguably the more correct
 * scope: a passkey is bound to the device in front of you, so
 * declining on a lab machine shouldn't silence the prompt on the phone
 * where you'd actually want one. It follows the same shape as the
 * other UI preferences kept here (hero autoplay, the gear scanner).
 *
 * Gated on `pages.my_security` for the same reason the pending card is
 * — it is the switch for passkey UI — with the added point that the
 * Security link below would otherwise 404.
 */
export function PasskeyNudge() {
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const enabled = flags.pages.my_security;

  const passkeys = useQuery({ ...passkeyListQueryOptions(), enabled });

  // Read at mount rather than through an effect. Nothing renders until
  // the passkey query settles, which can only happen on the client, so
  // the server and the first client pass both produce `null` here and
  // there is no hydration mismatch to guard against.
  const [dismissed, setDismissed] = useState(readDismissed);

  /**
   * Whether this member held zero passkeys **when the page loaded** —
   * snapshotted from the first settled read and never revisited.
   *
   * Reading the list live would be self-defeating: `useAddPasskey`
   * invalidates it, so a successful ceremony flips the answer and tears
   * this card down before anyone reads the confirmation it just
   * produced. A callback from the button cannot fix that either — the
   * hook's own `onSuccess` awaits the invalidation, so the refetch has
   * already landed by the time a per-`mutate` callback runs, and the
   * card is gone before it fires. Verified end to end, not reasoned
   * about: the latch looked right and failed on the real page.
   *
   * Snapshotting is also the honest rule. The question this nudge asks
   * is "does this member need an introduction to passkeys", which is
   * answered on arrival; nothing they do on the page makes it a
   * different question.
   */
  const [offer, setOffer] = useState<boolean | null>(null);
  const settled = enabled && !passkeys.isPending;
  const holdsNone = (passkeys.data?.length ?? 0) === 0;
  useEffect(() => {
    if (offer === null && settled) {
      setOffer(holdsNone);
    }
  }, [offer, settled, holdsNone]);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Dismissed for this page view regardless; it'll just come back.
    }
  };

  // `offer === null` covers the pre-settle window *and* SSR, where the
  // query never runs at all.
  if (!enabled || dismissed || offer !== true) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-4">
      <KeyRound
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex-1 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Sign in faster next time</h3>
          <p className="text-sm text-muted-foreground">
            Add a passkey and you can sign in with Face ID, Touch ID, a Windows
            Hello PIN, or a security key instead of waiting on an emailed link.
            Manage them any time on the{" "}
            <Link to="/my/security" className="underline underline-offset-4">
              Security
            </Link>{" "}
            tab.
          </p>
        </div>
        <AddPasskeyButton variant="compact" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-my-1 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss passkey suggestion"
        onClick={dismiss}
      >
        <X />
      </Button>
    </div>
  );
}

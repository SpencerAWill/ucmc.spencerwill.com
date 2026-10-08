import { useQuery } from "@tanstack/react-query";

import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

/**
 * "Set up faster sign-in" card for `/register/pending`.
 *
 * Enrollment is legal before approval — `webauthnRegisterBeginAction`
 * and its finish counterpart require a principal, not an approved one,
 * the same split that lets `ContactsEditor` / `BioEditor` sit on this
 * page. Until now the only add UI lived on `/my/security`, which is
 * behind `requireApproved`, so a member who registered on a device they
 * actually use couldn't enroll it until an exec acted.
 *
 * **Offered, never required.** Magic links remain the sign-in and
 * recovery path, so a mandatory passkey would add friction without
 * raising the bar — and plenty of people register on a lab machine or a
 * locked-down browser that can't create one at all. Nothing here blocks
 * review, which is what the surrounding "(optional)" section promises.
 *
 * Gated on `pages.my_security` even though this route isn't under
 * `/my`: the flag is the switch for passkey UI, and an exec flipping it
 * off would not expect one entry point to stay live. The nav-level
 * precedent is the same — a surface whose page is switched off stops
 * being offered rather than linking somewhere that 404s.
 *
 * Deliberately does **not** read the passkey list to hide itself once a
 * credential exists. A member re-reading this page may well want to
 * enroll a second device, and the in-session confirmation
 * `AddPasskeyButton` renders is what answers "did that work?" — the
 * question a reload isn't asking.
 */
export function PasskeyEnrollmentCard() {
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);

  if (!flags.pages.my_security) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Set up faster sign-in</h3>
        <p className="text-sm text-muted-foreground">
          Add a passkey and you can sign in with Face ID, Touch ID, a Windows
          Hello PIN, or a security key instead of waiting on an emailed link. Do
          it on a device you actually use — you can add more, or remove this
          one, from the Security tab once you&rsquo;re approved.
        </p>
      </div>
      <AddPasskeyButton variant="compact" />
    </div>
  );
}

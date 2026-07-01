import { useMutation } from "@tanstack/react-query";

import { requestMagicLinkFn } from "#/features/auth/server/server-fns";

/**
 * Request a magic-link email. Server is enumeration-proof — the
 * response shape doesn't reveal whether the email is registered, rate
 * limited, or seen for the first time. Caller pairs the email with the
 * Turnstile token (when the widget is rendered) and supplies its own
 * post-success / post-error UI; this hook just centralizes the
 * server-fn binding.
 */
export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (input: {
      email: string;
      turnstileToken: string;
      // Optional post-sign-in redirect target. Embedded in the emailed
      // callback URL so deep-link guards like `/my/*`'s `requireApproved`
      // can round-trip the user to their original destination after they
      // click the link. Server-side and client-side both reject values
      // that don't start with "/" to prevent open-redirect.
      redirect?: string;
    }) => requestMagicLinkFn({ data: input }),
  });
}

import { useMutation } from "@tanstack/react-query";

import { requestAddEmailFn } from "#/features/auth/server/email-fns";

/**
 * Send a verification magic link to a new email address. The address
 * is NOT attached to the account until the recipient clicks the link
 * (handled by `consumeAddEmailFn` on `/verify-email`), so we don't
 * invalidate the email list here — the consume path does that on its
 * own success.
 */
export function useAddEmail() {
  return useMutation({
    mutationFn: (email: string) => requestAddEmailFn({ data: { email } }),
  });
}

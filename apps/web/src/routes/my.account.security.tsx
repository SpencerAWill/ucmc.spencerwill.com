import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import {
  myEmailsQueryOptions,
  passkeyListQueryOptions,
} from "#/features/auth/api/queries";
import { useRemovePasskey } from "#/features/auth/api/use-remove-passkey";
import { useAuth } from "#/features/auth/api/use-auth";
import { EmailAddressesSection } from "#/features/auth/components/email-addresses-section";
import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import { Button } from "#/components/ui/button";

/**
 * Account → Sign-in. Surfaces the two ways a member authenticates:
 * verified email addresses (magic-link targets) and registered
 * passkeys. The tab URL is still `/my/account/security` — only the
 * label changed — so existing bookmarks keep working.
 *
 * Data export and account deletion moved to the Preferences tab; those
 * are privacy/account-management concerns rather than sign-in surface.
 *
 * Auth-gating is inherited from the parent `/my` layout (`my.tsx`),
 * which runs `requireApproved` for the entire `/my/*` namespace —
 * stricter than the `requireAuth` this route used to call directly.
 */
export const Route = createFileRoute("/my/account/security")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(passkeyListQueryOptions()),
      context.queryClient.ensureQueryData(myEmailsQueryOptions()),
    ]);
  },
  component: SignInPage,
});

function SignInPage() {
  const { principal } = useAuth();
  const query = useQuery(passkeyListQueryOptions());
  const removal = useRemovePasskey();

  const passkeys = query.data ?? [];

  if (!principal) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <EmailAddressesSection
        approved={principal.status === "approved"}
        primaryEmail={principal.primaryEmail}
      />

      <section className="space-y-3">
        <header>
          <h3 className="text-base font-medium">Passkeys</h3>
          <p className="text-sm text-muted-foreground">
            Passkeys let you sign in with Face ID, Touch ID, a Windows Hello
            PIN, or a hardware security key. Register one on every device you
            use and you&rsquo;ll never need the emailed sign-in link again.
          </p>
        </header>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&rsquo;t registered any passkeys yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {passkeys.map((p) => (
              <li
                key={p.credentialId}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.nickname ?? "Unnamed passkey"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Registered{" "}
                    {new Date(p.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {p.lastUsedAt
                      ? ` · last used ${new Date(
                          p.lastUsedAt,
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}`
                      : " · never used"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removal.isPending}
                  onClick={() => removal.mutate(p.credentialId)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <AddPasskeyButton />
      </section>

      <p className="text-xs text-muted-foreground">
        Looking to download your data or delete your account? Those live on the{" "}
        <Link to="/my/account/preferences" className="underline">
          Preferences
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

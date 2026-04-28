import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import { Button } from "#/components/ui/button";
import { requireAuth } from "#/features/auth/guards";
import {
  listPasskeysFn,
  removePasskeyFn,
} from "#/features/auth/server/webauthn-fns";

const PASSKEY_LIST_QUERY_KEY = ["account", "passkeys"] as const;

function passkeyListOptions() {
  return {
    queryKey: PASSKEY_LIST_QUERY_KEY,
    queryFn: async () => {
      const result = await listPasskeysFn();
      return result.ok ? result.passkeys : [];
    },
    staleTime: 30_000,
  } as const;
}

/**
 * Account → Security. Lists the user's registered passkeys with an
 * "Add this device" affordance and a per-row "Remove" button. Auth-gated
 * via the same `requireAuth` guard /register/pending uses.
 */
export const Route = createFileRoute("/account/security")({
  beforeLoad: async ({ context }) => {
    const principal = await requireAuth(context.queryClient);
    return { principal };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(passkeyListOptions());
  },
  component: SecurityPage,
});

function SecurityPage() {
  const query = useQuery(passkeyListOptions());
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: (credentialId: string) =>
      removePasskeyFn({ data: { credentialId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEY_LIST_QUERY_KEY });
    },
  });

  const passkeys = query.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Passkeys let you sign in with Face ID, Touch ID, a Windows Hello PIN,
          or a hardware security key. Register one on every device you use and
          you&rsquo;ll never need the emailed sign-in link again.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your passkeys</h2>
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
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add a passkey</h2>
        <AddPasskeyButton listQueryKey={PASSKEY_LIST_QUERY_KEY} />
      </section>
    </div>
  );
}

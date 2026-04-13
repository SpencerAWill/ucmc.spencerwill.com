import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "#/components/ui/button";
import { PasskeyEnrollCard } from "#/components/auth/passkey-enroll-card";
import { deletePasskeyFn, listPasskeysFn } from "#/server/auth/profile-queries";

export const Route = createFileRoute("/account/security")({
  component: SecurityPage,
});

function SecurityPage() {
  const queryClient = useQueryClient();
  const passkeysQuery = useQuery({
    queryKey: ["account", "passkeys"],
    queryFn: () => listPasskeysFn(),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deletePasskeyFn({ data: { id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["account", "passkeys"] }),
  });

  const passkeys = passkeysQuery.data?.passkeys ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <header>
          <h2 className="text-lg font-medium">Passkeys</h2>
          <p className="text-muted-foreground text-sm">
            Sign in with a fingerprint, face, or device PIN — no email link
            needed.
          </p>
        </header>
        {passkeys.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You haven’t added any passkeys yet.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {passkeys.map((pk) => (
              <li
                key={pk.id}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{pk.nickname ?? "Passkey"}</p>
                  <p className="text-muted-foreground text-xs">
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                    {pk.lastUsedAt
                      ? ` · last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMutation.mutate(pk.id)}
                  disabled={removeMutation.isPending}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PasskeyEnrollCard
        onEnrolled={() =>
          queryClient.invalidateQueries({ queryKey: ["account", "passkeys"] })
        }
      />
    </div>
  );
}

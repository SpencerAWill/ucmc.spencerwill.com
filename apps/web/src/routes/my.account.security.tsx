import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { passkeyListQueryOptions } from "#/features/auth/api/queries";
import { useDeleteMyAccount } from "#/features/auth/api/use-delete-my-account";
import { useRemovePasskey } from "#/features/auth/api/use-remove-passkey";
import { useAuth } from "#/features/auth/api/use-auth";
import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

/**
 * Account → Security. Lists the user's registered passkeys with an
 * "Add this device" affordance and a per-row "Remove" button.
 *
 * Auth-gating is inherited from the parent `/my` layout (`my.tsx`),
 * which runs `requireApproved` for the entire `/my/*` namespace —
 * stricter than the `requireAuth` this route used to call directly.
 */
export const Route = createFileRoute("/my/account/security")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(passkeyListQueryOptions());
  },
  component: SecurityPage,
});

function SecurityPage() {
  const query = useQuery(passkeyListQueryOptions());
  const removal = useRemovePasskey();

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
        <AddPasskeyButton />
      </section>

      <DataAndDeletionSection />
    </div>
  );
}

/**
 * Data export + account deletion. Both honor the promises on /privacy:
 * download a JSON copy of everything we have on you, and hard-delete
 * the account immediately. Deletion is gated by typing the email on
 * file — defends against accidental clicks more than it does against
 * deliberate misuse (a hostile actor with the session can already type
 * the email).
 */
function DataAndDeletionSection() {
  const { principal } = useAuth();
  const navigate = useNavigate();
  const deletion = useDeleteMyAccount();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const expectedEmail = principal?.email ?? "";
  const matches = confirmEmail.trim().toLowerCase() === expectedEmail;

  const onConfirm = () => {
    deletion.mutate(undefined, {
      onSuccess: async () => {
        toast.success("Account deleted");
        setOpen(false);
        await navigate({ to: "/" });
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Couldn't delete the account",
        );
      },
    });
  };

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-muted-foreground">
          Download a JSON copy of everything this site stores about you — your
          profile, emergency contacts, role memberships, and waiver attestation
          history. The export does not include passkey credentials or magic-link
          tokens.
        </p>
        <Button asChild variant="outline">
          <a href="/api/account/export" download>
            Download my data
          </a>
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-destructive">
          Delete account
        </h2>
        <p className="text-sm text-muted-foreground">
          Permanently delete your account, profile, emergency contacts,
          passkeys, sessions, and waiver attestation history. This is immediate
          and irreversible — there is no recovery on the other side. Authored
          announcements stay (anonymized) so the timeline for other members
          remains intact.
        </p>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete my account</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This is permanent. Type{" "}
                <strong className="font-mono">{expectedEmail}</strong> to
                confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="confirm-delete-email" className="text-sm">
                Email
              </Label>
              <Input
                id="confirm-delete-email"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={expectedEmail}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setConfirmEmail("")}
                disabled={deletion.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
                disabled={!matches || deletion.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletion.isPending ? "Deleting…" : "Delete forever"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </>
  );
}

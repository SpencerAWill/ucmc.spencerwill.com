import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useTheme } from "#/components/theme-provider";
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
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { useAuth } from "#/features/auth/api/use-auth";
import { useDeleteMyAccount } from "#/features/auth/api/use-delete-my-account";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * Preferences tab. Theme toggle plus the privacy controls (data export
 * and account deletion) that used to live under Security. They moved
 * here because downloading your data and deleting your account are
 * account-management concerns, not authentication surface.
 *
 * Future per-user preferences (email notifications, default trip
 * visibility, etc.) will persist to D1 and slot in under new section
 * headers above the danger zone.
 */
export const Route = createFileRoute("/my/_tabs/preferences")({
  staticData: { pageFlag: "my_preferences" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_preferences");
  },
  component: PreferencesPage,
});

const THEME_OPTIONS = ["light", "dark", "system"] as const;

function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-lg font-medium">Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Personalize how the site looks for you and manage your account data.
        </p>
      </header>

      <section className="space-y-2">
        <p className="text-sm font-medium" id="theme-label">
          Theme
        </p>
        {/*
         * ToggleGroup rather than three Buttons whose `variant` flips on
         * the selected value: this is a single-choice control, and the
         * radiogroup semantics come for free — arrow keys move between
         * options, `aria-checked` reports the active one, and the group
         * is one tab stop instead of three. `type="single"` with a
         * non-empty `value` also makes "nothing selected" unrepresentable,
         * where the old version relied on `theme` happening to match one
         * of the three literals.
         */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby="theme-label"
          value={theme}
          onValueChange={(next) => {
            // Radix hands back a plain string, and fires "" when the
            // active item is re-pressed. Narrowing through `find` keeps
            // `setTheme` fed a real `Theme` without a cast, and makes the
            // deselect case a no-op.
            const picked = THEME_OPTIONS.find((mode) => mode === next);
            if (picked) {
              setTheme(picked);
            }
          }}
        >
          {THEME_OPTIONS.map((mode) => (
            <ToggleGroupItem key={mode} value={mode}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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

  const expectedEmail = principal?.primaryEmail ?? "";
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
        <h3 className="text-base font-medium">Your data</h3>
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
        <h3 className="text-base font-medium text-destructive">
          Delete account
        </h3>
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

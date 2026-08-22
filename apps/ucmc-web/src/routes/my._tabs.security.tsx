import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "#/components/ui/item";
import { Skeleton } from "#/components/ui/skeleton";
import { passkeyListQueryOptions } from "#/features/auth/api/queries";
import { useAuth } from "#/features/auth/api/use-auth";
import { useRemovePasskey } from "#/features/auth/api/use-remove-passkey";
import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { formatDate } from "#/lib/date-format";

/**
 * `/my/security` — registered passkeys. Route path and tab label now
 * agree on "Security"; the tab used to read "Sign-in" over a
 * `/security` URL, which made the two impossible to talk about
 * together.
 *
 * Email addresses moved to the Details tab (they're contact details as
 * much as they are magic-link targets), leaving this page to the
 * credential a member actually manages here. Data export and account
 * deletion live on Preferences — privacy/account-management concerns
 * rather than authentication surface.
 *
 * Auth-gating is inherited from the parent `/my` layout (`my.tsx`),
 * which runs `requireApproved` for the entire `/my/*` namespace.
 */
export const Route = createFileRoute("/my/_tabs/security")({
  staticData: { pageFlag: "my_security" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_security");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(passkeyListQueryOptions());
  },
  component: SecurityPage,
});

function SecurityPage() {
  const { principal } = useAuth();
  const query = useQuery(passkeyListQueryOptions());
  const removal = useRemovePasskey();

  const passkeys = query.data ?? [];

  if (!principal) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
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
          // Skeleton rows rather than a "Loading…" line: the list is
          // already laid out by `ItemGroup`, so matching its shape keeps
          // the Add button from jumping once the query resolves.
          <ItemGroup className="gap-2">
            {[0, 1].map((i) => (
              <Item key={i} variant="outline" size="sm" role="listitem">
                <ItemContent className="min-w-0 gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        ) : passkeys.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound />
              </EmptyMedia>
              <EmptyTitle>No passkeys yet</EmptyTitle>
              <EmptyDescription>
                Add one below to sign in without waiting on an emailed link.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          // `Item` rather than a hand-rolled `<li className="rounded-md
          // border p-3">`: same primitive the email list uses, so both
          // credential lists share one visual treatment for free.
          <ItemGroup className="gap-2">
            {passkeys.map((p) => (
              <Item
                key={p.credentialId}
                variant="outline"
                size="sm"
                // `ItemGroup` is a `role="list"` div, so its children have
                // to carry `listitem` for the mapping to be valid ARIA.
                role="listitem"
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0">
                    <span className="min-w-0 flex-1 truncate">
                      {p.nickname ?? "Unnamed passkey"}
                    </span>
                  </ItemTitle>
                  <ItemDescription>
                    Registered {formatDate(p.createdAt)}
                    {p.lastUsedAt
                      ? ` · last used ${formatDate(p.lastUsedAt)}`
                      : " · never used"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removal.isPending}
                    onClick={() => removal.mutate(p.credentialId)}
                  >
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}

        <AddPasskeyButton />
      </section>

      <p className="text-xs text-muted-foreground">
        Looking to download your data or delete your account? Those live on the{" "}
        <Link to="/my/preferences" className="underline">
          Preferences
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

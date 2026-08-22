import { useQuery } from "@tanstack/react-query";
import { Check, KeyRound, Pencil, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
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
import { useRemovePasskey } from "#/features/auth/api/use-remove-passkey";
import { useRenamePasskey } from "#/features/auth/api/use-rename-passkey";
import { AddPasskeyButton } from "#/features/auth/components/passkey-button";
import type { PasskeySummary } from "#/features/auth/server/webauthn-fns";
import { formatDate } from "#/lib/date-format";

/** Same cap as registration (`registerFinishInput`) and the rename
 *  validator, so the field can't accept more than the server stores. */
const NICKNAME_MAX = 60;

/**
 * "Passkeys" section on the Security tab (`/my/security`). Lists every
 * credential registered to the account with its registration and
 * last-used dates, an inline rename, and a remove button; below the
 * list, `AddPasskeyButton` drives the registration ceremony.
 *
 * Renaming exists because a member names a passkey at registration —
 * exactly when they have the least context — and the label only starts
 * mattering once there's a second device. Without it the only way to
 * relabel is remove-and-re-register, which is a real ceremony and
 * temporarily strands anyone whose passkey was their only one. Anybody
 * who skipped the optional nickname is otherwise stuck reading "Unnamed
 * passkey" forever.
 */
export function PasskeySection() {
  const query = useQuery(passkeyListQueryOptions());
  const passkeys = query.data ?? [];

  // One row at a time holds the editor. Tracking the credential ID
  // rather than a boolean means opening a second row implicitly
  // abandons the first, which is the behavior you want from a list
  // where only one label can be in flight.
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <header>
        <h3 className="text-base font-medium">Passkeys</h3>
        <p className="text-sm text-muted-foreground">
          Passkeys let you sign in with Face ID, Touch ID, a Windows Hello PIN,
          or a hardware security key. Register one on every device you use and
          you&rsquo;ll never need the emailed sign-in link again.
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
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.credentialId}
              passkey={passkey}
              editing={editingId === passkey.credentialId}
              onEdit={() => setEditingId(passkey.credentialId)}
              onDone={() => setEditingId(null)}
            />
          ))}
        </ItemGroup>
      )}

      <AddPasskeyButton />
    </section>
  );
}

function PasskeyRow({
  passkey,
  editing,
  onEdit,
  onDone,
}: {
  passkey: PasskeySummary;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const removal = useRemovePasskey();
  const rename = useRenamePasskey();
  const [draft, setDraft] = useState(passkey.nickname ?? "");

  const label = passkey.nickname ?? "Unnamed passkey";

  const save = () => {
    rename.mutate(
      { credentialId: passkey.credentialId, nickname: draft },
      {
        onSuccess: (result) => {
          // The server fn resolves with a result object rather than
          // throwing, so an unhappy path lands here, not in onError.
          if (!result.ok) {
            toast.error(
              result.reason === "not_found"
                ? "That passkey no longer exists."
                : "Couldn’t rename that passkey.",
            );
            return;
          }
          toast.success("Passkey renamed");
          onDone();
        },
        onError: () => {
          toast.error("Couldn’t rename that passkey. Please try again.");
        },
      },
    );
  };

  const cancel = () => {
    setDraft(passkey.nickname ?? "");
    onDone();
  };

  return (
    <Item
      variant="outline"
      size="sm"
      // `ItemGroup` is a `role="list"` div, so its children have to
      // carry `listitem` for the mapping to be valid ARIA.
      role="listitem"
    >
      {editing ? (
        <ItemContent className="min-w-0">
          <InputGroup>
            <InputGroupInput
              autoFocus
              value={draft}
              maxLength={NICKNAME_MAX}
              placeholder="e.g. iPhone, YubiKey, Work laptop"
              aria-label={`Rename ${label}`}
              disabled={rename.isPending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter/Escape are what anyone typing in a one-field
                // inline editor reaches for; the buttons stay for
                // pointer users. The input is not inside a <form>, so
                // Enter would otherwise do nothing at all.
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                aria-label="Save name"
                disabled={rename.isPending}
                onClick={save}
              >
                <Check />
              </InputGroupButton>
              <InputGroupButton
                type="button"
                aria-label="Cancel rename"
                disabled={rename.isPending}
                onClick={cancel}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <ItemDescription>
            Leave it empty to go back to no name.
          </ItemDescription>
        </ItemContent>
      ) : (
        <>
          <ItemContent className="min-w-0">
            <ItemTitle className="w-full min-w-0">
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </ItemTitle>
            <ItemDescription>
              Registered {formatDate(passkey.createdAt)}
              {passkey.lastUsedAt
                ? ` · last used ${formatDate(passkey.lastUsedAt)}`
                : " · never used"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Rename ${label}`}
              onClick={() => {
                // Re-seed from the stored value so a previously
                // abandoned edit doesn't reappear.
                setDraft(passkey.nickname ?? "");
                onEdit();
              }}
            >
              <Pencil className="mr-1 size-3.5" />
              Rename
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removal.isPending}
              onClick={() => removal.mutate(passkey.credentialId)}
            >
              Remove
            </Button>
          </ItemActions>
        </>
      )}
    </Item>
  );
}

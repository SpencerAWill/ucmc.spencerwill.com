import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, UserPlus } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { membersDirectoryQueryOptions } from "#/features/members/api/queries";

/** One picked member, shaped for `RoleDetail.members`. */
export interface PickedMember {
  userId: string;
  email: string;
  preferredName: string | null;
}

/**
 * Approved-member search used to stage additions on the role sheet's
 * Members tab. Built on the members directory query rather than
 * `features/gear`'s `MemberSearchCombobox`: that one reads a
 * gear-feature server fn gated on `gear:loan`, and features can't
 * import each other. The directory query only requires an approved
 * principal and already locks non-`members:manage` callers to
 * approved-status rows, which is exactly the eligible set — pending,
 * rejected, and unclaimed accounts can't hold roles.
 *
 * Debounced via `useDeferredValue`, matching the gear combobox: React
 * batches the deferred update so the input stays responsive while the
 * search fires at its discretion, and TanStack Query caches repeats.
 *
 * `excludeUserIds` drops members already staged on the role so the
 * list only ever offers a real change.
 */
export function RoleMemberPicker({
  excludeUserIds,
  onPick,
  disabled,
}: {
  excludeUserIds: Set<string>;
  onPick: (member: PickedMember) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input).trim();

  // Empty search would page the whole directory, so hold the query
  // until there's something to match on.
  const { data, isFetching } = useQuery({
    ...membersDirectoryQueryOptions({
      search: deferred,
      sort: "name_asc",
      limit: 20,
    }),
    enabled: open && deferred.length > 0,
  });

  const results = (data?.rows ?? []).filter(
    (m) => !excludeUserIds.has(m.userId),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <UserPlus className="size-4" />
            Add a member…
          </span>
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        {/* `shouldFilter={false}` because the server already filtered:
            `listMembersAction` matches `search` against full name,
            preferred name, and every verified email. Command's own
            fuzzy pass on top would re-filter that result set by a
            different rule and could drop a row the server considered a
            match — an email hit whose visible label is a name, say. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search by name or email…"
          />
          <CommandList>
            {isFetching ? (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : null}
            <CommandEmpty>
              {deferred.length === 0
                ? "Start typing a name or email…"
                : isFetching
                  ? null
                  : "No approved members match."}
            </CommandEmpty>
            {results.map((member) => (
              <CommandItem
                key={member.userId}
                value={member.userId}
                onSelect={() => {
                  onPick({
                    userId: member.userId,
                    email: member.email,
                    preferredName: member.preferredName,
                  });
                  setInput("");
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {member.preferredName ?? member.fullName ?? member.email}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

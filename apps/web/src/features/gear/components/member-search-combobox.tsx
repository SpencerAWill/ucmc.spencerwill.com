import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
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
import { cn } from "#/lib/utils";
import { memberLoanSearchQueryOptions } from "#/features/gear/api/queries";
import type { MemberSearchResult } from "#/features/gear/server/gear-fns";

/**
 * Approved-member picker for the checkout flow. Debounced via
 * `useDeferredValue` rather than a manual setTimeout — React batches
 * the deferred update so the input stays responsive while the search
 * fires at React's discretion. TanStack Query's caching keeps repeat
 * queries cheap.
 *
 * Callers control the selected member by passing the full row (or
 * null when nothing's picked); this lets the trigger render the
 * member's display name without an extra fetch.
 */
export function MemberSearchCombobox({
  selected,
  onSelect,
  disabled,
}: {
  selected: MemberSearchResult | null;
  onSelect: (member: MemberSearchResult) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input);
  const { data, isFetching } = useQuery(memberLoanSearchQueryOptions(deferred));
  const results = data ?? [];

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
          {selected ? (
            <span className="truncate text-left">
              {selected.fullName}
              <span className="ml-2 text-xs text-muted-foreground">
                {selected.primaryEmail}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              Search by name or email…
            </span>
          )}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search by name or email…"
            // Auto-focus on open is the popover's default.
          />
          <CommandList>
            {isFetching ? (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : null}
            <CommandEmpty>
              {input.trim().length === 0
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
                  onSelect(member);
                  setOpen(false);
                  setInput("");
                }}
              >
                <Check
                  className={cn(
                    "mr-2 size-4",
                    selected?.userId === member.userId
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{member.fullName}</span>
                  <span className="text-xs text-muted-foreground">
                    {member.primaryEmail}
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

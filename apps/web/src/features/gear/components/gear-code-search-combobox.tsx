import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
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
import { gearCodeSearchQueryOptions } from "#/features/gear/api/queries";
import type { GearLookupRow } from "#/features/gear/server/gear-fns";

/**
 * Code-prefix search for adding gear to a checkout / check-in batch.
 * Stateless — it doesn't track selection; just fires `onPick` and the
 * caller routes the row into local state.
 *
 * `mode` parameter controls the inline-eligibility hint shown next to
 * each row (checkout cares about availability; check-in cares about
 * whether there's an open loan). Server returns the same row shape
 * either way — the filter happens in the UI.
 */
export function GearCodeSearchCombobox({
  mode,
  onPick,
  disabled,
}: {
  mode: "checkout" | "checkin";
  onPick: (row: GearLookupRow) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input);
  const { data } = useQuery(gearCodeSearchQueryOptions(deferred));
  const results = (data ?? []).filter((row) => {
    // Inline filter for mode-specific eligibility. Server is the
    // source of truth at submit; this just hides obvious nope rows.
    if (mode === "checkout") {
      return (
        row.lifecycle === "active" &&
        row.condition === "serviceable" &&
        !row.hasOpenLoan
      );
    }
    return row.hasOpenLoan;
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" disabled={disabled}>
          <Search className="size-4" />
          Search code
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
            placeholder={
              mode === "checkout"
                ? "Enter code (CH1, LJ3…)"
                : "Enter code to check in…"
            }
          />
          <CommandList>
            <CommandEmpty>
              {input.trim().length === 0
                ? "Start typing a code prefix…"
                : mode === "checkout"
                  ? "No eligible gear matches."
                  : "No open loan matches that code."}
            </CommandEmpty>
            {results.map((row) => (
              <CommandItem
                key={row.publicId}
                value={row.code}
                onSelect={() => {
                  onPick(row);
                  setOpen(false);
                  setInput("");
                }}
              >
                <span className="flex flex-1 flex-col">
                  <span className="font-mono font-medium">{row.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.typeName} · {row.description}
                  </span>
                </span>
                {mode === "checkin" && row.openLoanMemberFullName ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.openLoanMemberFullName}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

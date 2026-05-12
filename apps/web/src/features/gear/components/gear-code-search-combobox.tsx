import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { gearCodeSearchQueryOptions } from "#/features/gear/api/queries";
import type { GearLookupRow } from "#/features/gear/server/gear-fns";

/**
 * Inline code-prefix search for the items pane. Designed to feel like
 * a barcode scanner that takes keystrokes: officer types a code (or a
 * prefix), Enter adds the first match to the list, the input clears,
 * and they're ready for the next one. No button, no popover — the
 * input is always there, and the suggestion list appears beneath
 * it as the officer types.
 *
 * The pane does NOT wrap this in a `<form>`, so Enter inside the
 * input only fires `cmdk`'s `onSelect` on the highlighted item — it
 * never triggers a stray form submission.
 *
 * `mode` controls the inline-eligibility filter:
 *   - "checkout": only eligible gear (active + serviceable + no open
 *     loan) — what you can hand out.
 *   - "checkin": only gear with an open loan — what's eligible to
 *     come back.
 * The server returns the same row shape either way; the filter
 * happens in the UI for snappier feedback. Server-side checks at
 * submit time remain the source of truth.
 */
export function GearCodeSearchCombobox({
  mode,
  onPick,
  disabled,
  excludePublicIds = [],
}: {
  mode: "checkout" | "checkin";
  onPick: (row: GearLookupRow) => void;
  disabled?: boolean;
  /** Hide rows whose publicId is in this set — typically the gear
   *  already added to the batch. Avoids the awkward "I already added
   *  CH1, why is it still in the dropdown" moment. */
  excludePublicIds?: readonly string[];
}) {
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input);
  const { data } = useQuery(gearCodeSearchQueryOptions(deferred));
  const excluded = new Set(excludePublicIds);
  const results = (data ?? []).filter((row) => {
    if (excluded.has(row.publicId)) return false;
    if (mode === "checkout") {
      return (
        row.lifecycle === "active" &&
        row.condition === "serviceable" &&
        !row.hasOpenLoan
      );
    }
    return row.hasOpenLoan;
  });

  const handleSelect = (row: GearLookupRow) => {
    onPick(row);
    setInput("");
  };

  return (
    <Command
      shouldFilter={false}
      className="overflow-visible rounded-md border bg-transparent"
    >
      <CommandInput
        value={input}
        onValueChange={(v) => {
          if (!disabled) setInput(v);
        }}
        placeholder={
          mode === "checkout"
            ? "Enter code (CH1, LJ3…) and press Enter"
            : "Enter code to check in…"
        }
        disabled={disabled}
      />
      {input.trim().length > 0 ? (
        <CommandList>
          <CommandEmpty>
            {mode === "checkout"
              ? "No eligible gear matches."
              : "No open loan matches that code."}
          </CommandEmpty>
          {results.map((row) => (
            <CommandItem
              key={row.publicId}
              value={row.code}
              onSelect={() => handleSelect(row)}
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
      ) : null}
    </Command>
  );
}

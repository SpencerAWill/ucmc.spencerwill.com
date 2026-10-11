import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  countedDeskSearchQueryOptions,
  gearCodeSearchQueryOptions,
  openCountedLoanSearchQueryOptions,
} from "#/features/gear/api/queries";
import type {
  DeskCountedLoan,
  DeskCountedModel,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";

/**
 * Inline search for the items pane. Designed to feel like a barcode
 * scanner that takes keystrokes: officer types a code (or a prefix),
 * Enter adds the first match to the list, the input clears, and they're
 * ready for the next one. No button, no popover — the input is always
 * there, and the suggestion list appears beneath it as the officer types.
 *
 * The pane does NOT wrap this in a `<form>`, so Enter inside the
 * input only fires `cmdk`'s `onSelect` on the highlighted item — it
 * never triggers a stray form submission.
 *
 * Two groups, from two queries:
 *   - **Coded** — pieces whose code matches, exactly as before. The
 *     code lookup stays its own query on purpose: widening it into a
 *     union would change what a typed `CH9` matches.
 *   - **Counted** — what has no code to type. At checkout, counted
 *     models matching the model name ("draws"). At check-in, open
 *     counted LOANS matching the model or the borrower ("Riley"),
 *     because a return has to land on somebody's loan.
 * Coded results come first, so a typed code plus Enter still adds the
 * piece it always did.
 *
 * `mode` also controls the inline-eligibility filter for coded rows:
 *   - "checkout": only eligible gear (active + serviceable + no open
 *     loan) — what you can hand out.
 *   - "checkin": only gear with an open loan — what's eligible to
 *     come back.
 * The filter happens in the UI for snappier feedback. Server-side
 * checks at submit time remain the source of truth.
 */
type ModeProps =
  | {
      mode: "checkout";
      onPickCounted: (model: DeskCountedModel) => void;
    }
  | {
      mode: "checkin";
      onPickCounted: (loan: DeskCountedLoan) => void;
    };

export function GearCodeSearchCombobox({
  onPick,
  disabled,
  excludePublicIds = [],
  ...modeProps
}: ModeProps & {
  onPick: (row: GearLookupRow) => void;
  disabled?: boolean;
  /** Hide rows whose publicId is in this set — the pieces, models or
   *  loans already in the batch. Avoids the awkward "I already added
   *  CH1, why is it still in the dropdown" moment. */
  excludePublicIds?: readonly string[];
}) {
  const [input, setInput] = useState("");
  const deferred = useDeferredValue(input);
  const { data, isFetching: fetchingCodes } = useQuery(
    gearCodeSearchQueryOptions(deferred),
  );
  // Both counted queries are declared and only the mode's own is
  // enabled — hooks can't be called conditionally, and an unconditional
  // disabled query costs nothing.
  const { data: countedModels, isFetching: fetchingModels } = useQuery({
    ...countedDeskSearchQueryOptions(deferred),
    enabled: modeProps.mode === "checkout" && deferred.trim().length > 0,
  });
  const { data: countedLoans, isFetching: fetchingLoans } = useQuery({
    ...openCountedLoanSearchQueryOptions(deferred),
    enabled: modeProps.mode === "checkin" && deferred.trim().length > 0,
  });
  const excluded = new Set(excludePublicIds);
  const results = (data ?? []).filter((row) => {
    if (excluded.has(row.publicId)) return false;
    if (modeProps.mode === "checkout") {
      return (
        row.status === "active" &&
        row.condition === "serviceable" &&
        !row.hasOpenLoan
      );
    }
    return row.hasOpenLoan;
  });
  const models =
    modeProps.mode === "checkout"
      ? (countedModels ?? []).filter((m) => !excluded.has(m.publicId))
      : [];
  const loans =
    modeProps.mode === "checkin"
      ? (countedLoans ?? []).filter((l) => !excluded.has(l.loanPublicId))
      : [];

  const clear = () => setInput("");

  return (
    <Command
      shouldFilter={false}
      className="overflow-visible rounded-md border bg-transparent"
    >
      <CommandInput
        // Opts this input out of the wedge listener's text-field
        // protection, so a scan taken while the caret sits here is
        // routed to the desk's `handleScan` rather than resolved by
        // cmdk. Both would "work", and that is the problem: cmdk picks
        // the first PREFIX match while `handleScan` looks the code up
        // exactly, so without this one trigger pull means two different
        // things depending on where focus happened to be. See
        // `use-barcode-wedge.ts`.
        data-wedge-capture=""
        value={input}
        onValueChange={(v) => {
          if (!disabled) setInput(v);
        }}
        placeholder={
          // Short enough to survive a phone-width Sheet. The counted
          // half is named ("draws", a borrower) because nothing else
          // tells the officer the box searches past codes.
          modeProps.mode === "checkout"
            ? "Enter code (CH1…) or gear name, press Enter"
            : "Enter code to check in, or a name…"
        }
        disabled={disabled}
      />
      {input.trim().length > 0 ? (
        <CommandList>
          <CommandEmpty>
            {/* Two queries race here; saying "no match" while the
                counted one is still in flight reads as a wrong answer. */}
            {fetchingCodes || fetchingModels || fetchingLoans
              ? "Searching…"
              : modeProps.mode === "checkout"
                ? "No eligible gear matches."
                : "No open loan matches."}
          </CommandEmpty>
          {results.length > 0 ? (
            <CommandGroup
              heading={models.length + loans.length > 0 ? "Coded" : undefined}
            >
              {results.map((row) => (
                <CommandItem
                  key={row.publicId}
                  value={row.code}
                  onSelect={() => {
                    onPick(row);
                    clear();
                  }}
                >
                  <span className="flex flex-1 flex-col">
                    <span className="font-mono font-medium">{row.code}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.typeName} · {row.name}
                    </span>
                  </span>
                  {modeProps.mode === "checkin" &&
                  row.openLoanMemberFullName ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.openLoanMemberFullName}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {models.length > 0 && modeProps.mode === "checkout" ? (
            <CommandGroup heading="Counted">
              {models.map((model) => (
                <CommandItem
                  key={model.publicId}
                  // Prefixed so it can never collide with a code's value
                  // in cmdk's selection state.
                  value={`model:${model.publicId}`}
                  disabled={model.takeable === 0 && model.held === 0}
                  onSelect={() => {
                    modeProps.onPickCounted(model);
                    clear();
                  }}
                >
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">{model.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {model.typeName}
                    </span>
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                    {model.takeable} available
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {loans.length > 0 && modeProps.mode === "checkin" ? (
            <CommandGroup heading="Counted">
              {loans.map((loan) => (
                <CommandItem
                  key={loan.loanPublicId}
                  value={`loan:${loan.loanPublicId}`}
                  onSelect={() => {
                    modeProps.onPickCounted(loan);
                    clear();
                  }}
                >
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">
                      {loan.outstanding} × {loan.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {loan.typeName}
                    </span>
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {loan.memberFullName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      ) : null}
    </Command>
  );
}

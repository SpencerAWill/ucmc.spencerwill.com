import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { fetchGearByCode } from "#/features/gear/api/queries";
import { useCheckinLoans } from "#/features/gear/api/use-checkin-loans";
import { BarcodeScanner } from "#/features/gear/components/barcode-scanner";
import { CheckinItemRow } from "#/features/gear/components/gear-desk-item-row";
import { GearCodeSearchCombobox } from "#/features/gear/components/gear-code-search-combobox";
import type {
  CheckinLoansResult,
  GearCondition,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";

interface CheckinItem {
  row: GearLookupRow;
  conditionAtReturn: GearCondition | null;
  notes: string;
  error?: string;
}

const SKIP_LABEL: Record<
  Extract<CheckinLoansResult["results"][number], { ok: false }>["reason"],
  string
> = {
  not_found: "No longer in inventory",
  no_open_loan: "No open loan to close — already returned?",
};

export function GearDeskCheckinPane({ onSuccess }: { onSuccess: () => void }) {
  const [items, setItems] = useState<CheckinItem[]>([]);
  const checkin = useCheckinLoans();

  const addRow = (row: GearLookupRow) => {
    setItems((prev) => {
      if (prev.some((i) => i.row.publicId === row.publicId)) return prev;
      return [...prev, { row, conditionAtReturn: null, notes: "" }];
    });
  };

  const handleScan = async (code: string) => {
    try {
      const row = await fetchGearByCode(code);
      if (!row) {
        toast.error(`No gear matches code "${code}".`);
        return;
      }
      if (!row.hasOpenLoan) {
        toast.error(`${row.code} doesn't have an open loan to close.`);
        return;
      }
      addRow(row);
    } catch {
      toast.error("Couldn't look up that code.");
    }
  };

  const submit = () => {
    if (items.length === 0) {
      toast.error("Add at least one piece to check in.");
      return;
    }
    checkin.mutate(
      {
        items: items.map((i) => ({
          gearPublicId: i.row.publicId,
          conditionAtReturn: i.conditionAtReturn,
          notes: i.notes.trim() || null,
        })),
      },
      {
        onSuccess: (data) => {
          const ok = data.results.flatMap((r) => (r.ok ? [r] : []));
          const skipped = data.results.flatMap((r) => (r.ok ? [] : [r]));
          if (ok.length > 0) {
            // Build a borrower-aware confirmation. Single borrower is
            // the common case; multi-borrower says "from N members".
            const borrowers = new Set(ok.map((r) => r.memberFullName));
            const borrowerSummary =
              borrowers.size === 1
                ? `from ${[...borrowers][0]}`
                : `from ${borrowers.size} members`;
            const tail =
              skipped.length > 0 ? ` (${skipped.length} skipped)` : "";
            toast.success(
              `Checked in ${ok.length} ${ok.length === 1 ? "piece" : "pieces"} ${borrowerSummary}${tail}`,
            );
          }
          setItems((prev) => {
            const skippedIds = new Set(skipped.map((s) => s.gearPublicId));
            return prev
              .filter((i) => skippedIds.has(i.row.publicId))
              .map((i) => {
                const reason = skipped.find(
                  (s) => s.gearPublicId === i.row.publicId,
                );
                return {
                  ...i,
                  error: reason ? SKIP_LABEL[reason.reason] : undefined,
                };
              });
          });
          if (skipped.length === 0) onSuccess();
        },
        onError: () =>
          toast.error("Couldn't process the check-in. Please try again."),
      },
    );
  };

  // Group rows by borrower name when more than one shows up. Mirrors
  // the sketch in the plan: small borrower-name header above each
  // group so the officer can confirm visually who's returning what.
  const groups = items.reduce<Map<string, CheckinItem[]>>((acc, item) => {
    const name = item.row.openLoanMemberFullName ?? "Unknown";
    const list = acc.get(name) ?? [];
    list.push(item);
    acc.set(name, list);
    return acc;
  }, new Map());

  return (
    <div className="space-y-4">
      {/* Side-by-side on md+: viewfinder + running returning list.
          Sticky viewfinder + sticky-on-mobile header — same pattern
          as the checkout pane; see that pane for the rationale. */}
      {/* Sticky viewfinder — see checkout pane for the layout
          rationale (sticky's containing block is the grid, not the
          cell; `items-start` keeps the cell content-height). */}
      <div className="grid items-start gap-4 md:grid-cols-[18rem_1fr]">
        <div className="sticky top-0 z-10 space-y-1.5 bg-background pb-2 md:pb-0">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Scan
          </Label>
          <BarcodeScanner onResult={handleScan} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Returning ({items.length})
          </Label>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Scan a barcode or search for a code below to check gear back in.
              Multiple borrowers in one batch is fine.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="w-10">Borrower</TableHead>
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...groups.entries()].map(([name, group]) => (
                  <Fragment key={name}>
                    {groups.size > 1 ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell
                          colSpan={4}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {name}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {group.map((item) => {
                      const idx = items.indexOf(item);
                      return (
                        <CheckinItemRow
                          key={item.row.publicId}
                          row={item.row}
                          conditionAtReturn={item.conditionAtReturn}
                          onConditionChange={(c) =>
                            setItems((prev) =>
                              prev.map((p, pi) =>
                                pi === idx ? { ...p, conditionAtReturn: c } : p,
                              ),
                            )
                          }
                          notes={item.notes}
                          onNotesChange={(notes) =>
                            setItems((prev) =>
                              prev.map((p, pi) =>
                                pi === idx ? { ...p, notes } : p,
                              ),
                            )
                          }
                          error={item.error}
                          onRemove={() =>
                            setItems((prev) =>
                              prev.filter((_, pi) => pi !== idx),
                            )
                          }
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
          {/* Search anchored at the bottom — newly added rows append
              to the table above, so the most recently picked piece
              sits directly over the input. */}
          <GearCodeSearchCombobox
            mode="checkin"
            onPick={addRow}
            disabled={checkin.isPending}
            excludePublicIds={items.map((i) => i.row.publicId)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={submit}
          disabled={checkin.isPending || items.length === 0}
        >
          {checkin.isPending
            ? "Checking in…"
            : `Check in ${items.length || ""} ${items.length === 1 ? "item" : "items"}`.trim()}
        </Button>
      </div>
    </div>
  );
}

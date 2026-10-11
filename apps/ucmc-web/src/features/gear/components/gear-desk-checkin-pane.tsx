import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import {
  fetchGearByCode,
  fetchOpenCountedLoansForModel,
} from "#/features/gear/api/queries";
import { UserAvatar } from "#/components/user-avatar";
import { useCheckinLoans } from "#/features/gear/api/use-checkin-loans";
import { DeskScanControls } from "#/features/gear/components/desk-scan-controls";
import {
  CheckinItemRow,
  CountedCheckinItemRow,
} from "#/features/gear/components/gear-desk-item-row";
import { GearCodeSearchCombobox } from "#/features/gear/components/gear-code-search-combobox";
import {
  isForeignSymbology,
  parseScanPayload,
} from "#/features/gear/lib/scan-payload";
import { sumDeskUnits } from "#/features/gear/lib/desk-units";
import { formatDate } from "#/lib/date-format";
import type {
  CheckinLoansResult,
  DeskCountedLoan,
  GearCondition,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";

/** One row of the batch: a coded piece by its code, or units coming
 *  back on one open counted loan. Mirrors the server's per-row union. */
type CheckinItem =
  | {
      kind: "coded";
      row: GearLookupRow;
      conditionAtReturn: GearCondition | null;
      notes: string;
      error?: string;
    }
  | {
      kind: "counted";
      loan: DeskCountedLoan;
      quantity: number;
      notes: string;
      error?: string;
    };

type CheckinResult = CheckinLoansResult["results"][number];

/** The publicId a row is keyed on — its piece, or its LOAN (never the
 *  model: two borrowers can have the same draws out). */
function itemKey(item: CheckinItem): string {
  return item.kind === "coded" ? item.row.publicId : item.loan.loanPublicId;
}

function resultKey(result: CheckinResult): string {
  return result.kind === "coded" ? result.gearPublicId : result.loanPublicId;
}

function borrowerName(item: CheckinItem): string {
  return item.kind === "coded"
    ? (item.row.openLoanMemberFullName ?? "Unknown")
    : item.loan.memberFullName;
}

const SKIP_LABEL: Record<
  Extract<CheckinResult, { ok: false }>["reason"],
  string
> = {
  not_found: "No longer in inventory",
  no_open_loan: "No open loan to close — already returned?",
  not_counted: "Tracked by code — scan the piece itself",
  exceeds_outstanding: "More than are still out on this loan",
};

export function GearDeskCheckinPane({ onSuccess }: { onSuccess: () => void }) {
  const [items, setItems] = useState<CheckinItem[]>([]);
  const checkin = useCheckinLoans();

  const [focusKey, setFocusKey] = useState<string | null>(null);

  const addRow = (row: GearLookupRow) => {
    setItems((prev) => {
      if (prev.some((i) => itemKey(i) === row.publicId)) return prev;
      return [
        ...prev,
        { kind: "coded", row, conditionAtReturn: null, notes: "" },
      ];
    });
  };

  /** Add an open counted loan, prefilled to everything still out — "all
   *  six came back" is the common case, and the field takes focus so a
   *  short return is one keystroke away. */
  const addCountedLoan = (
    loan: DeskCountedLoan,
    { focus = true }: { focus?: boolean } = {},
  ) => {
    setItems((prev) => {
      if (prev.some((i) => itemKey(i) === loan.loanPublicId)) return prev;
      return [
        ...prev,
        { kind: "counted", loan, quantity: loan.outstanding, notes: "" },
      ];
    });
    // Cleared on a scan so an earlier pick's key can't hand autoFocus to
    // the row a scan adds — see the checkout pane.
    setFocusKey(focus ? loan.loanPublicId : null);
  };

  // Open loans a scanned bin label matched when there was more than one
  // — two members with the same draws out. The officer picks whose.
  const [binChoices, setBinChoices] = useState<DeskCountedLoan[] | null>(null);

  /**
   * A scanned bin label names a model, and a return has to land on a
   * LOAN. One open loan of it: add that. Several: ask whose. Focus stays
   * put after a scan, for the reason the checkout pane gives — a focused
   * number field is where a gun without an AIM prefix would type the
   * next scan.
   */
  const handleBinScan = async (modelPublicId: string) => {
    const loans = await fetchOpenCountedLoansForModel(modelPublicId).catch(
      () => null,
    );
    if (loans === null) {
      toast.error("Couldn't look up that bin label.");
      return;
    }
    const added = new Set(items.map(itemKey));
    const fresh = loans.filter((l) => !added.has(l.loanPublicId));
    const only = fresh.at(0);
    if (only === undefined) {
      toast.error(
        loans.length > 0
          ? "Every open loan of that gear is already in this batch."
          : "Nobody has that gear out.",
      );
      return;
    }
    if (fresh.length === 1) {
      addCountedLoan(only, { focus: false });
      return;
    }
    setBinChoices(fresh);
  };

  const updateItem = (key: string, patch: (item: CheckinItem) => CheckinItem) =>
    setItems((prev) => prev.map((p) => (itemKey(p) === key ? patch(p) : p)));

  const handleScan = async (raw: string) => {
    const payload = parseScanPayload(raw);
    if (!payload) {
      toast.error("That didn't look like a gear label.");
      return;
    }
    if (payload.kind === "cart") {
      // A member's cart is pre-checkout intent; it says nothing about
      // what they are handing back. Naming that beats a lookup failure
      // on a 46-character token.
      toast.error("That's a cart QR — scan the gear itself to check it in.");
      return;
    }
    if (payload.kind === "model") {
      await handleBinScan(payload.modelPublicId);
      return;
    }
    const code = payload.code;
    try {
      const row = await fetchGearByCode(code);
      if (!row) {
        toast.error(
          // See the checkout pane: a transmitted AIM symbology we never
          // print means the officer scanned the manufacturer's own mark.
          isForeignSymbology(payload.symbology)
            ? "That's the manufacturer's own tag, not a UCMC label — scan the club tag instead."
            : `No gear matches code "${code}".`,
        );
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
        items: items.map((i) =>
          i.kind === "coded"
            ? {
                kind: "coded" as const,
                gearPublicId: i.row.publicId,
                conditionAtReturn: i.conditionAtReturn,
                notes: i.notes.trim() || null,
              }
            : {
                kind: "counted" as const,
                loanPublicId: i.loan.loanPublicId,
                quantity: i.quantity,
                notes: i.notes.trim() || null,
              },
        ),
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
            const pieces = sumDeskUnits(ok);
            // A short return leaves the loan open; say so in the
            // confirmation, so nobody reads "checked in" as "closed".
            const stillOut = ok.reduce(
              (sum, r) => sum + (r.kind === "counted" ? r.outstanding : 0),
              0,
            );
            const tail = [
              stillOut > 0 ? `${stillOut} still out` : null,
              skipped.length > 0 ? `${skipped.length} skipped` : null,
            ].filter((part) => part !== null);
            toast.success(
              `Checked in ${pieces} ${pieces === 1 ? "piece" : "pieces"} ${borrowerSummary}${tail.length > 0 ? ` (${tail.join(", ")})` : ""}`,
            );
          }
          setItems((prev) => {
            return prev.flatMap((i) => {
              const refusal = skipped.find(
                (s) => s.kind === i.kind && resultKey(s) === itemKey(i),
              );
              if (!refusal) return [];
              if (
                i.kind === "counted" &&
                refusal.kind === "counted" &&
                refusal.reason === "exceeds_outstanding" &&
                refusal.outstanding !== null
              ) {
                // Somebody else's return landed first. Take the server's
                // count into the row itself — its max, its "of N out" and
                // its quantity — not only into the message, or the field
                // keeps offering the stale number and refuses again.
                const outstanding = refusal.outstanding;
                return [
                  {
                    ...i,
                    loan: { ...i.loan, outstanding },
                    quantity: Math.min(i.quantity, Math.max(1, outstanding)),
                    error: `Only ${outstanding} still out on this loan`,
                  },
                ];
              }
              return [{ ...i, error: SKIP_LABEL[refusal.reason] }];
            });
          });
          if (skipped.length === 0) onSuccess();
        },
        onError: () =>
          toast.error("Couldn't process the check-in. Please try again."),
      },
    );
  };

  // Units, not rows — six draws coming back is six items, the same
  // count the checkout button uses.
  const returningUnits = sumDeskUnits(items);

  // Group rows by borrower name when more than one shows up. Mirrors
  // the sketch in the plan: small borrower-name header above each
  // group so the officer can confirm visually who's returning what.
  const groups = items.reduce<Map<string, CheckinItem[]>>((acc, item) => {
    const name = borrowerName(item);
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
        <div className="sticky top-0 z-10 bg-background pb-2 md:pb-0">
          <DeskScanControls onScan={handleScan} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Returning ({returningUnits})
          </Label>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Scan a barcode or search below — a code, counted gear, or the
              borrower&apos;s name. Multiple borrowers in one batch is fine.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Gear</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="w-10">User</TableHead>
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
                      const key = itemKey(item);
                      const remove = () => {
                        setItems((prev) =>
                          prev.filter((p) => itemKey(p) !== key),
                        );
                        if (focusKey === key) setFocusKey(null);
                      };
                      const setNotes = (notes: string) =>
                        updateItem(key, (p) => ({ ...p, notes }));
                      if (item.kind === "counted") {
                        return (
                          <CountedCheckinItemRow
                            key={key}
                            loan={item.loan}
                            quantity={item.quantity}
                            onQuantityChange={(quantity) =>
                              updateItem(key, (p) =>
                                p.kind === "counted"
                                  ? { ...p, quantity, error: undefined }
                                  : p,
                              )
                            }
                            notes={item.notes}
                            onNotesChange={setNotes}
                            error={item.error}
                            onRemove={remove}
                            autoFocus={focusKey === key}
                          />
                        );
                      }
                      return (
                        <CheckinItemRow
                          key={key}
                          row={item.row}
                          conditionAtReturn={item.conditionAtReturn}
                          onConditionChange={(c) =>
                            updateItem(key, (p) =>
                              p.kind === "coded"
                                ? { ...p, conditionAtReturn: c }
                                : p,
                            )
                          }
                          notes={item.notes}
                          onNotesChange={setNotes}
                          error={item.error}
                          onRemove={remove}
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
            onPickCounted={addCountedLoan}
            disabled={checkin.isPending}
            excludePublicIds={items.map(itemKey)}
          />
        </div>
      </div>

      <Dialog
        open={binChoices !== null}
        onOpenChange={(open) => {
          if (!open) setBinChoices(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Whose are these?</DialogTitle>
            <DialogDescription>
              More than one member has {binChoices?.at(0)?.name ?? "this gear"}{" "}
              out. Pick the loan they&apos;re coming back on.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(binChoices ?? []).map((loan) => (
              <li key={loan.loanPublicId}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-between gap-3 py-2 text-left"
                  onClick={() => {
                    addCountedLoan(loan, { focus: false });
                    setBinChoices(null);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar
                      avatarKey={loan.memberAvatarKey}
                      name={loan.memberFullName}
                      className="size-7"
                    />
                    <span className="truncate">{loan.memberFullName}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {loan.outstanding} out · due{" "}
                    {formatDate(loan.dueAt, { month: "short", day: "numeric" })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end">
        <Button
          onClick={submit}
          disabled={checkin.isPending || items.length === 0}
        >
          {checkin.isPending
            ? "Checking in…"
            : `Check in ${returningUnits || ""} ${returningUnits === 1 ? "item" : "items"}`.trim()}
        </Button>
      </div>
    </div>
  );
}

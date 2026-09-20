import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { Textarea } from "#/components/ui/textarea";
import { useAuth } from "#/features/auth/api/use-auth";
import { fetchGearByCode } from "#/features/gear/api/queries";
import { useCheckoutLoans } from "#/features/gear/api/use-checkout-loans";
import { BarcodeScanner } from "#/features/gear/components/barcode-scanner";
import { DueDatePicker } from "#/features/gear/components/due-date-picker";
import { CheckoutItemRow } from "#/features/gear/components/gear-desk-item-row";
import { GearCodeSearchCombobox } from "#/features/gear/components/gear-code-search-combobox";
import { MemberSearchCombobox } from "#/features/gear/components/member-search-combobox";
import { SKIP_OVERRIDE_FLAG } from "#/features/gear/lib/availability";
import type { CheckoutOverrideFlag } from "#/features/gear/lib/availability";
import { isCartToken } from "#/features/gear/lib/cart-token";
import { DEFAULT_LOAN_DURATION_DAYS } from "#/features/gear/lib/loan-duration";
import {
  resolveCartTokenFn,
  getMemberForLoanFn,
} from "#/features/gear/server/gear-fns";
import type {
  CartItemAvailability,
  CartItemRow,
  CheckoutSkipReason,
  GearLookupRow,
  MemberSearchResult,
} from "#/features/gear/server/gear-fns";

interface CheckoutItem {
  row: GearLookupRow;
  durationDays: number;
  error?: string;
  /** Set only by a server refusal, and only for the rows the server
   *  actually refused. `error` alone can't drive the override affordance
   *  — cart rows carry a pre-submit `error` the server never saw. */
  blocked?: CheckoutSkipReason;
}

const SKIP_LABEL: Record<CheckoutSkipReason, string> = {
  not_found: "No longer in inventory",
  retired: "No longer active in the collection",
  not_serviceable: "Condition isn't serviceable",
  already_on_loan: "Already checked out to someone else",
  on_hold: "Held for a trip",
  member_blocked: "Member is blocked — overdue gear outstanding",
};

/**
 * Maps a cart row's availability flag to the same vocabulary the
 * server uses for post-submit skip reasons. `loanable` rows have no
 * error string; everything else flags the row as unsubmittable until
 * the officer removes it.
 *
 * `no_code` is intentionally absent — null-code rows are filtered out
 * before they ever reach `cartItemToCheckoutItem` (the desk needs a
 * scannable code on every row), so there's no error string to surface.
 */
const CART_AVAILABILITY_LABEL: Partial<Record<CartItemAvailability, string>> = {
  on_loan: "Already checked out to someone else",
  not_serviceable: "Condition isn't serviceable",
  not_in_cave: "Not in the cave",
  on_hold: "Held for a trip",
  retired: "Retired since the cart was built",
};

/**
 * Adapts a hydrated cart row into the desk pane's `CheckoutItem`
 * shape. Caller must filter `code === null` rows before calling — the
 * desk pane's existing `GearLookupRow` type requires a non-null code.
 */
function cartItemToCheckoutItem(
  cartItem: CartItemRow & { code: string },
  defaultDurationDays: number,
): CheckoutItem {
  const row: GearLookupRow = {
    publicId: cartItem.publicId,
    code: cartItem.code,
    name: cartItem.name,
    typeName: cartItem.typeName,
    thumbnailKey: cartItem.thumbnailKey,
    status: cartItem.status,
    condition: cartItem.condition,
    hasOpenLoan: cartItem.hasOpenLoan,
    // Cart hydration doesn't fetch the borrower's display info — the
    // member's cart is their own intent, not someone else's loan. The
    // CheckoutItemRow renderer falls back gracefully when these are null.
    openLoanMemberFullName: null,
    openLoanMemberAvatarKey: null,
  };
  return {
    row,
    durationDays: defaultDurationDays,
    error: CART_AVAILABILITY_LABEL[cartItem.availability],
  };
}

export function GearDeskCheckoutPane({ onSuccess }: { onSuccess: () => void }) {
  const [member, setMember] = useState<MemberSearchResult | null>(null);
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [notes, setNotes] = useState("");
  // Default due date the officer picks up front. Every newly-added
  // item adopts this value; the officer can still per-row override
  // after the fact. Changing the default does NOT retroactively
  // change items already in the list (predictability over
  // cleverness — if we cascaded, "did I override CH7 yet?" becomes
  // ambiguous fast).
  const [defaultDurationDays, setDefaultDurationDays] = useState<number>(
    DEFAULT_LOAN_DURATION_DAYS,
  );
  const checkout = useCheckoutLoans();
  const { hasPermission } = useAuth();
  // `gear:loan` runs the desk; overriding a hold or a blocked member is
  // the `gear:manage` grant's call, and the action re-checks it. The
  // gate here only decides whether the button is worth showing.
  const canOverride = hasPermission("gear:manage");
  const [overrideOpen, setOverrideOpen] = useState(false);

  const addRow = (row: GearLookupRow) => {
    setItems((prev) => {
      // Prevent duplicates in the batch — server would reject the
      // second one with `already_on_loan` after the first inserts,
      // but the UX is better if the row's just rejected up front.
      if (prev.some((i) => i.row.publicId === row.publicId)) return prev;
      return [...prev, { row, durationDays: defaultDurationDays }];
    });
  };

  const handleScan = async (code: string) => {
    if (isCartToken(code)) {
      await handleCartScan(code);
      return;
    }
    try {
      const row = await fetchGearByCode(code);
      if (!row) {
        toast.error(`No gear matches code "${code}".`);
        return;
      }
      if (
        row.status !== "active" ||
        row.condition !== "serviceable" ||
        row.hasOpenLoan
      ) {
        toast.error(`${row.code} can't be checked out right now.`);
        return;
      }
      addRow(row);
    } catch {
      toast.error("Couldn't look up that code.");
    }
  };

  /**
   * Resolve a member-scanned `ucmc-cart:<uuid>` payload at the desk:
   *   - 'expired' / 'member_unavailable' surfaces as a targeted toast.
   *   - On success: if the desk already has a different member selected,
   *     refuse rather than silently swap. Otherwise seed the member and
   *     append every cart row, visually flagging any row whose
   *     availability is anything but `loanable` so the officer must
   *     remove it before submitting.
   */
  const handleCartScan = async (token: string) => {
    let resolved;
    try {
      resolved = await resolveCartTokenFn({ data: { token } });
    } catch {
      toast.error("Couldn't read that cart QR.");
      return;
    }
    if (!resolved.ok) {
      if (resolved.reason === "expired") {
        toast.error("Cart QR expired — ask the member to refresh it.");
      } else {
        toast.error("Member is no longer eligible to borrow gear.");
      }
      return;
    }
    if (member && member.publicId !== resolved.cart.memberPublicId) {
      toast.error(
        "This cart belongs to a different member. Clear the current selection first.",
      );
      return;
    }
    // Hydrate a MemberSearchResult so the combobox renders the chip.
    // The cart-resolve payload only ships publicId + name + email, but
    // the combobox also wants `userId`; fetch the full row.
    try {
      const memberRow = await getMemberForLoanFn({
        data: { publicId: resolved.cart.memberPublicId },
      });
      if (memberRow) {
        setMember(memberRow);
      }
    } catch {
      // Combobox is best-effort — already-set member from a prior scan
      // / search stays.
    }
    // Skip rows whose code was cleared after the member added them —
    // the desk has no scannable identifier to attach a loan to. They
    // remain in the member's cart with `availability: "no_code"` so
    // the member sees the flag; the officer just doesn't get them.
    const codedItems = resolved.cart.items.filter(
      (i): i is typeof i & { code: string } => i.code !== null,
    );
    const skippedNoCode = resolved.cart.items.length - codedItems.length;
    setItems((prev) => {
      const next = [...prev];
      for (const cartItem of codedItems) {
        if (next.some((i) => i.row.publicId === cartItem.publicId)) continue;
        next.push(cartItemToCheckoutItem(cartItem, defaultDurationDays));
      }
      return next;
    });
    const blocked = codedItems.filter(
      (i) => i.availability !== "loanable",
    ).length;
    if (blocked > 0 || skippedNoCode > 0) {
      const tail = skippedNoCode > 0 ? ` (${skippedNoCode} untagged)` : "";
      toast.warning(
        `Added ${codedItems.length} items; ${blocked} need attention before checkout${tail}.`,
      );
    } else {
      toast.success(`Added ${codedItems.length} items from cart.`);
    }
  };

  /**
   * Submit one batch. `rows` is the whole list on a first attempt and
   * only the overridable refusals on a retry, so the result handler
   * reconciles per row rather than replacing the list wholesale —
   * a hard-stop row the retry left out must stay on screen with its
   * reason, not vanish because it wasn't in this response.
   */
  const runCheckout = (
    rows: CheckoutItem[],
    overrides: Partial<Record<CheckoutOverrideFlag, boolean>>,
  ) => {
    if (!member) {
      toast.error("Pick a member first.");
      return;
    }
    if (rows.length === 0) {
      toast.error("Add at least one gear piece.");
      return;
    }
    const submittedIds = new Set(rows.map((r) => r.row.publicId));
    const untouched = items.filter((i) => !submittedIds.has(i.row.publicId));
    checkout.mutate(
      {
        memberPublicId: member.publicId,
        items: rows.map((i) => ({
          gearPublicId: i.row.publicId,
          durationDays: i.durationDays,
        })),
        notes: notes.trim() || null,
        ...overrides,
      },
      {
        onSuccess: (data) => {
          const ok = data.results.filter((r) => r.ok);
          const skipped = data.results.flatMap((r) => (r.ok ? [] : [r]));
          if (ok.length > 0) {
            const tail =
              skipped.length > 0 ? ` (${skipped.length} skipped)` : "";
            toast.success(
              `Checked out ${ok.length} ${ok.length === 1 ? "piece" : "pieces"} to ${member.fullName}${tail}`,
            );
          }
          // Keep skipped rows in the form with their reason so the
          // officer can fix and retry without re-adding.
          setItems((prev) =>
            prev.flatMap((item) => {
              if (!submittedIds.has(item.row.publicId)) return [item];
              const refusal = skipped.find(
                (sk) => sk.gearPublicId === item.row.publicId,
              );
              if (!refusal) return [];
              return [
                {
                  ...item,
                  error: SKIP_LABEL[refusal.reason],
                  blocked: refusal.reason,
                },
              ];
            }),
          );
          if (skipped.length === 0 && untouched.length === 0) {
            setMember(null);
            setNotes("");
            onSuccess();
          }
        },
        onError: () => {
          toast.error("Couldn't process the checkout. Please try again.");
        },
      },
    );
  };

  const submit = () => {
    if (items.some((i) => i.error)) {
      toast.error("Remove unavailable items before checking out.");
      return;
    }
    runCheckout(items, {});
  };

  // Rows the server refused for a reason an officer is allowed to push
  // through, paired with the flag each one wants. Anything else the
  // server refused stays put and stays a hard stop.
  const overridable = items.flatMap((item) => {
    const reason = item.blocked;
    if (reason === undefined) return [];
    const flag = SKIP_OVERRIDE_FLAG[reason];
    return flag === undefined ? [] : [{ item, reason, flag }];
  });
  const overrideFlags = Array.from(new Set(overridable.map((o) => o.flag)));
  const overrideReasons = Array.from(
    new Set(overridable.map((o) => SKIP_LABEL[o.reason])),
  );

  const confirmOverride = () => {
    setOverrideOpen(false);
    runCheckout(
      overridable.map((o) => o.item),
      Object.fromEntries(overrideFlags.map((flag) => [flag, true])),
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Member
          </Label>
          <MemberSearchCombobox
            selected={member}
            onSelect={setMember}
            disabled={checkout.isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Default due
          </Label>
          {/* Up-front default for newly-added items. The picker doesn't
              retroactively change items already in the list (see the
              `defaultDurationDays` rationale in component state). */}
          <DueDatePicker
            id="checkout-default-due"
            label=""
            durationDays={defaultDurationDays}
            onDurationChange={setDefaultDurationDays}
            disabled={checkout.isPending}
          />
        </div>
      </div>

      {/* Side-by-side on md+: viewfinder column on the left, running
          items list on the right. Stacks vertically on narrow viewports.
          The viewfinder column is sticky inside the Sheet's scroll
          context — on desktop it pins to the top of its grid cell as
          the items column grows; on mobile it pins to the top of the
          Sheet as items scroll past. Either way the officer keeps
          eyes on the scan target while the batch grows. */}
      {/* Sticky viewfinder works on both breakpoints because the
          containing block for `position: sticky` is the *grid*
          container, not the grid cell. On desktop (2 columns) the
          grid is one tall row (height = items column); on mobile
          (1 column) the grid is two rows where row 2 (items) is tall.
          Either way the grid extends below the sticky viewfinder,
          giving it room to pin. `items-start` keeps the cell at its
          natural content height instead of stretching to match the
          row — without it, the cell would fill the row vertically and
          the viewfinder would visually look stretched. */}
      <div className="grid items-start gap-4 md:grid-cols-[18rem_1fr]">
        <div className="sticky top-0 z-10 space-y-1.5 bg-background pb-2 md:pb-0">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Scan
          </Label>
          <BarcodeScanner onResult={handleScan} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Items ({items.length})
          </Label>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Scan a barcode or search for a code below to add gear.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <CheckoutItemRow
                    key={item.row.publicId}
                    row={item.row}
                    durationDays={item.durationDays}
                    onDurationChange={(d) =>
                      setItems((prev) =>
                        prev.map((p, pi) =>
                          pi === idx ? { ...p, durationDays: d } : p,
                        ),
                      )
                    }
                    error={item.error}
                    onRemove={() =>
                      setItems((prev) => prev.filter((_, pi) => pi !== idx))
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {/* Search anchored at the bottom — items added via the input
              append to the table above, so the most recently picked
              piece sits directly over the search. The pane has no
              surrounding <form>, so Enter only fires cmdk's onSelect;
              no stray form submission. */}
          <GearCodeSearchCombobox
            mode="checkout"
            onPick={addRow}
            disabled={checkout.isPending}
            excludePublicIds={items.map((i) => i.row.publicId)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="checkout-notes"
          className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
        >
          Notes (optional)
        </Label>
        <Textarea
          id="checkout-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Trip name, special instructions, etc."
          rows={2}
          maxLength={2000}
        />
      </div>

      {/* Override lives below the batch, not on the row: a blocked
          member refuses every row at once, and a per-row button would
          invite clicking through the same decision six times. It only
          appears once the server has actually refused something, so
          the ordinary path never shows a way around the rules. */}
      {canOverride && overridable.length > 0 ? (
        <div className="space-y-2 rounded-md border border-dashed border-destructive/50 bg-destructive/5 p-3">
          <p className="text-sm font-medium">
            {overridable.length} {overridable.length === 1 ? "piece" : "pieces"}{" "}
            refused: {overrideReasons.join("; ")}.
          </p>
          <p className="text-xs text-muted-foreground">
            You can check {overridable.length === 1 ? "it" : "them"} out anyway.
            The override is recorded against your name in the audit log.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOverrideOpen(true)}
            disabled={checkout.isPending}
          >
            Override and check out
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={submit}
          disabled={checkout.isPending || !member || items.length === 0}
        >
          {checkout.isPending
            ? "Checking out…"
            : `Check out ${items.length || ""} ${items.length === 1 ? "item" : "items"}`.trim()}
        </Button>
      </div>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override and check out?</DialogTitle>
            <DialogDescription>
              {overrideReasons.join("; ")}. Checking out anyway is recorded
              against your name, with the reason, on every piece in this batch.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {overridable.map((o) => (
              <li key={o.item.row.publicId} className="flex gap-2">
                <span className="font-mono font-semibold">
                  {o.item.row.code}
                </span>
                <span className="text-muted-foreground">
                  {SKIP_LABEL[o.reason]}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmOverride} disabled={checkout.isPending}>
              Override and check out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

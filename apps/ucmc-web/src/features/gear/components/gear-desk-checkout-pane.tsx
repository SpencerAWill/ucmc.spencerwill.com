import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { CLUB_TIME_ZONE } from "#/config/time";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  fetchDeskModel,
  fetchGearByCode,
  loanDefaultsQueryOptions,
} from "#/features/gear/api/queries";
import { useCheckoutLoans } from "#/features/gear/api/use-checkout-loans";
import { DeskScanControls } from "#/features/gear/components/desk-scan-controls";
import { DueDatePicker } from "#/features/gear/components/due-date-picker";
import {
  CheckoutItemRow,
  CountedCheckoutItemRow,
} from "#/features/gear/components/gear-desk-item-row";
import { GearCodeSearchCombobox } from "#/features/gear/components/gear-code-search-combobox";
import { MemberSearchCombobox } from "#/features/gear/components/member-search-combobox";
import { SKIP_OVERRIDE_FLAG } from "#/features/gear/lib/availability";
import type { CheckoutOverrideFlag } from "#/features/gear/lib/availability";
import {
  DEFAULT_LOAN_DURATION_DAYS,
  defaultLoanDurationDays,
} from "#/features/gear/lib/loan-duration";
import { sumDeskUnits } from "#/features/gear/lib/desk-units";
import {
  isForeignSymbology,
  parseScanPayload,
} from "#/features/gear/lib/scan-payload";
import {
  resolveCartTokenFn,
  getMemberForLoanFn,
} from "#/features/gear/server/gear-fns";
import type {
  CartItemAvailability,
  CartItemRow,
  CheckoutLoansResult,
  CheckoutSkipReason,
  DeskCountedModel,
  GearLookupRow,
  MemberSearchResult,
} from "#/features/gear/server/gear-fns";

type CheckoutResult = CheckoutLoansResult["results"][number];

interface CheckoutItemState {
  durationDays: number;
  error?: string;
  /** Set only by a server refusal, and only for the rows the server
   *  actually refused. `error` alone can't drive the override affordance
   *  — cart rows carry a pre-submit `error` the server never saw. */
  blocked?: CheckoutSkipReason;
}

/** One row of the batch: a coded piece, or a quantity of a counted
 *  model. Mirrors the server's per-row union. */
type CheckoutItem =
  | (CheckoutItemState & { kind: "coded"; row: GearLookupRow })
  | (CheckoutItemState & {
      kind: "counted";
      model: DeskCountedModel;
      quantity: number;
    });

/** The publicId a row is keyed on — the same identity the server echoes
 *  back on each result, so refusals reconcile onto the right row. */
function itemKey(item: CheckoutItem): string {
  return item.kind === "coded" ? item.row.publicId : item.model.publicId;
}

function resultKey(result: CheckoutResult): string {
  return result.kind === "coded" ? result.gearPublicId : result.modelPublicId;
}

/** How the override dialog names a row: its code, or "6 × BD HotForge". */
function itemLabel(item: CheckoutItem): string {
  return item.kind === "coded"
    ? item.row.code
    : `${item.quantity} × ${item.model.name}`;
}

const SKIP_LABEL: Record<CheckoutSkipReason, string> = {
  not_found: "No longer in inventory",
  retired: "No longer active in the collection",
  not_serviceable: "Condition isn't serviceable",
  already_on_loan: "Already checked out to someone else",
  on_hold: "Held for a trip",
  member_blocked: "Member is blocked — overdue gear outstanding",
  not_counted: "Tracked by code — scan the piece itself",
  insufficient_stock: "Not enough on the shelf",
};

/** A refusal's message. Counted refusals carry how many there were, so
 *  "only 4 available" can replace a bare "not enough". */
function refusalMessage(
  refusal: Extract<CheckoutResult, { ok: false }>,
): string {
  if (refusal.kind === "counted" && refusal.available !== null) {
    if (refusal.reason === "insufficient_stock") {
      return `Only ${refusal.available} on the shelf`;
    }
    if (refusal.reason === "on_hold") {
      return `Held for a trip — only ${refusal.available} free`;
    }
  }
  return SKIP_LABEL[refusal.reason];
}

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
    kind: "coded",
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
  // `gear.defaultLoanDays` is the policy; the constant is only what the
  // sheet shows for the instant before the query resolves. A long
  // `staleTime` on the query keeps the number from moving under the
  // officer mid-checkout, and `loan-duration.test.ts` pins the two
  // values equal so there is no visible flicker on load.
  const { data: loanDefaults } = useQuery(loanDefaultsQueryOptions());
  const [defaultDurationDays, setDefaultDurationDays] = useState<number>(
    DEFAULT_LOAN_DURATION_DAYS,
  );
  // Adopt the configured default once, and only while the officer
  // hasn't touched the control — changing it out from under a deliberate
  // choice would be worse than showing the fallback a moment longer.
  const [durationTouched, setDurationTouched] = useState(false);
  useEffect(() => {
    if (!durationTouched && loanDefaults) {
      // Rolled forward to the next day the cave is open, so the suggested
      // due date is one the member can actually meet. This is the ONLY
      // place the cave's hours move a date — the officer overrides freely
      // and the server stores whatever is submitted (#242).
      setDefaultDurationDays(
        defaultLoanDurationDays(
          Temporal.Now.zonedDateTimeISO(CLUB_TIME_ZONE).toPlainDate(),
          loanDefaults.defaultLoanDays,
          loanDefaults.caveOpenWeekdays,
        ),
      );
    }
  }, [durationTouched, loanDefaults]);
  const caveOpenWeekdays = loanDefaults?.caveOpenWeekdays ?? [];
  const checkout = useCheckoutLoans();
  const { hasPermission } = useAuth();
  // `gear:loan` runs the desk; overriding a hold or a blocked member is
  // the `gear:manage` grant's call, and the action re-checks it. The
  // gate here only decides whether the button is worth showing.
  const canOverride = hasPermission("gear:manage");
  const [overrideOpen, setOverrideOpen] = useState(false);

  // The row whose quantity field should take focus — set when a counted
  // model joins the batch, because the next thing the officer does is
  // type how many. Keyed rather than a ref so it survives the row
  // mounting after the state update.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const addRow = (row: GearLookupRow) => {
    setItems((prev) => {
      // Prevent duplicates in the batch — server would reject the
      // second one with `already_on_loan` after the first inserts,
      // but the UX is better if the row's just rejected up front.
      if (prev.some((i) => itemKey(i) === row.publicId)) return prev;
      return [
        ...prev,
        { kind: "coded", row, durationDays: defaultDurationDays },
      ];
    });
  };

  /** Add a counted model at quantity 1, or — when it's already in the
   *  batch — leave it be and send focus back to its quantity. The boundary
   *  refuses a model twice per batch, and "how many" is one field. */
  const addCounted = (
    model: DeskCountedModel,
    { focus = true }: { focus?: boolean } = {},
  ) => {
    setItems((prev) => {
      // Re-checked inside the updater, not only by the caller: two scans
      // of one bin inside a lookup's round trip both pass a check made
      // against the render they started in.
      if (prev.some((i) => itemKey(i) === model.publicId)) return prev;
      return [
        ...prev,
        {
          kind: "counted",
          model,
          quantity: 1,
          durationDays: defaultDurationDays,
        },
      ];
    });
    // Cleared on a scan rather than left pointing at an earlier pick:
    // a stale key would hand autoFocus to whatever row mounts next for
    // that model, scans included.
    setFocusKey(focus ? model.publicId : null);
  };

  const updateItem = (key: string, patch: Partial<CheckoutItemState>) =>
    setItems((prev) =>
      prev.map((p) => (itemKey(p) === key ? { ...p, ...patch } : p)),
    );

  const handleScan = async (raw: string) => {
    const payload = parseScanPayload(raw);
    if (!payload) {
      toast.error("That didn't look like a gear label.");
      return;
    }
    if (payload.kind === "cart") {
      await handleCartScan(payload.token);
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
          // A reader that transmits its AIM symbology tells us the tag
          // came off something we never printed — a manufacturer's
          // DataMatrix on the harness itself, most likely. Naming that
          // beats "no gear matches 3F8A91C2", which reads as a broken
          // label.
          isForeignSymbology(payload.symbology)
            ? "That's the manufacturer's own tag, not a UCMC label — scan the club tag instead."
            : `No gear matches code "${code}".`,
        );
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
   * Resolve a scanned `ucmc-model:` bin label: add the model at quantity
   * 1, for the officer to correct.
   *
   * **Focus deliberately stays where it was.** Moving it into the new
   * row's quantity field would be the natural next step for a human,
   * but the wedge treats a focused number field as text it must not
   * capture into — so the next scan from a gun without an AIM prefix
   * would type "CH93" into the quantity and set it to 93. A pick from
   * the combobox does focus the field, because the officer is already
   * typing.
   */
  const handleBinScan = async (modelPublicId: string) => {
    const resolved = await fetchDeskModel(modelPublicId).catch(() => null);
    if (resolved === null) {
      toast.error("Couldn't look up that bin label.");
      return;
    }
    if (!resolved.ok) {
      toast.error(
        resolved.reason === "not_counted"
          ? "That bin's model is tracked by code now — scan the pieces themselves."
          : "That bin label doesn't match any gear model.",
      );
      return;
    }
    const { model } = resolved;
    if (items.some((i) => itemKey(i) === model.publicId)) {
      toast.info(`${model.name} is already in this batch — set the quantity.`);
      return;
    }
    addCounted(model, { focus: false });
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
        if (next.some((i) => itemKey(i) === cartItem.publicId)) continue;
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
    const submittedIds = new Set(rows.map(itemKey));
    const untouched = items.filter((i) => !submittedIds.has(itemKey(i)));
    checkout.mutate(
      {
        memberPublicId: member.publicId,
        items: rows.map((i) =>
          i.kind === "coded"
            ? {
                kind: "coded" as const,
                gearPublicId: i.row.publicId,
                durationDays: i.durationDays,
              }
            : {
                kind: "counted" as const,
                modelPublicId: i.model.publicId,
                quantity: i.quantity,
                durationDays: i.durationDays,
              },
        ),
        notes: notes.trim() || null,
        ...overrides,
      },
      {
        onSuccess: (data) => {
          const ok = data.results.flatMap((r) => (r.ok ? [r] : []));
          const skipped = data.results.flatMap((r) => (r.ok ? [] : [r]));
          if (ok.length > 0) {
            // Units, not rows: "6 draws and a harness" is seven pieces
            // in the member's hands, which is what the officer confirms.
            const pieces = sumDeskUnits(ok);
            const tail =
              skipped.length > 0 ? ` (${skipped.length} skipped)` : "";
            toast.success(
              `Checked out ${pieces} ${pieces === 1 ? "piece" : "pieces"} to ${member.fullName}${tail}`,
            );
          }
          // Keep skipped rows in the form with their reason so the
          // officer can fix and retry without re-adding.
          setItems((prev) =>
            prev.flatMap((item) => {
              const key = itemKey(item);
              if (!submittedIds.has(key)) return [item];
              const refusal = skipped.find(
                (sk) => sk.kind === item.kind && resultKey(sk) === key,
              );
              if (!refusal) return [];
              return [
                {
                  ...item,
                  error: refusalMessage(refusal),
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
  const batchUnits = sumDeskUnits(items);

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
            onDurationChange={(days) => {
              // Marks the control as deliberately set, so a late-arriving
              // `gear.defaultLoanDays` can't overwrite the officer's own
              // choice a beat after they made it.
              setDurationTouched(true);
              setDefaultDurationDays(days);
            }}
            disabled={checkout.isPending}
            caveOpenWeekdays={caveOpenWeekdays}
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
        <div className="sticky top-0 z-10 bg-background pb-2 md:pb-0">
          <DeskScanControls onScan={handleScan} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Items ({batchUnits})
          </Label>
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Scan a barcode or search below — a code, or counted gear like
              draws.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* "Gear", not "Code": a counted row puts its
                      quantity in this column, since it has no code. */}
                  <TableHead className="w-20">Gear</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const key = itemKey(item);
                  const remove = () => {
                    setItems((prev) => prev.filter((p) => itemKey(p) !== key));
                    if (focusKey === key) setFocusKey(null);
                  };
                  if (item.kind === "counted") {
                    return (
                      <CountedCheckoutItemRow
                        key={key}
                        model={item.model}
                        quantity={item.quantity}
                        onQuantityChange={(quantity) =>
                          setItems((prev) =>
                            prev.map((p) =>
                              itemKey(p) === key && p.kind === "counted"
                                ? // A changed quantity is a new request:
                                  // a refusal of the old one no longer
                                  // describes it.
                                  {
                                    ...p,
                                    quantity,
                                    error: undefined,
                                    blocked: undefined,
                                  }
                                : p,
                            ),
                          )
                        }
                        durationDays={item.durationDays}
                        onDurationChange={(d) =>
                          updateItem(key, { durationDays: d })
                        }
                        error={item.error}
                        caveOpenWeekdays={caveOpenWeekdays}
                        onRemove={remove}
                        autoFocus={focusKey === key}
                      />
                    );
                  }
                  return (
                    <CheckoutItemRow
                      key={key}
                      row={item.row}
                      durationDays={item.durationDays}
                      onDurationChange={(d) =>
                        updateItem(key, { durationDays: d })
                      }
                      error={item.error}
                      caveOpenWeekdays={caveOpenWeekdays}
                      onRemove={remove}
                    />
                  );
                })}
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
            onPickCounted={addCounted}
            disabled={checkout.isPending}
            excludePublicIds={items.map(itemKey)}
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
            : `Check out ${batchUnits || ""} ${batchUnits === 1 ? "item" : "items"}`.trim()}
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
              <li key={itemKey(o.item)} className="flex gap-2">
                <span
                  className={
                    o.item.kind === "coded"
                      ? "font-mono font-semibold"
                      : "font-semibold"
                  }
                >
                  {itemLabel(o.item)}
                </span>
                <span className="text-muted-foreground">
                  {o.item.error ?? SKIP_LABEL[o.reason]}
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

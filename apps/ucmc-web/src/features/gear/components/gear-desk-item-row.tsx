import { AlertTriangle, StickyNote, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { TableCell, TableRow } from "#/components/ui/table";
import { Textarea } from "#/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { UserAvatar } from "#/components/user-avatar";
import { DeskQuantityInput } from "#/features/gear/components/desk-quantity-input";
import { DueDatePicker } from "#/features/gear/components/due-date-picker";
import { cn } from "#/lib/utils";
import {
  GEAR_CONDITION_VALUES,
  MAX_COUNTED_LOAN_QUANTITY,
} from "#/features/gear/server/gear-fns";
import type {
  DeskCountedLoan,
  DeskCountedModel,
  GearCondition,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";
import { CONDITION_LABEL } from "#/features/gear/lib/labels";

/**
 * Row components for the gear-desk items table. The parent pane owns
 * the surrounding `<Table>`/`<TableHeader>`; each row here renders its
 * controls, then a `SubjectLine` naming the gear, then an error line
 * when there is one. Both extra lines span every column beneath the
 * controls, so the column grid stays intact.
 *
 * Table (vs. the shadcn `Item` primitive) buys real column alignment
 * for free: `<thead>` sets the column widths once and every `<tr>`
 * inherits them.
 */

const CODE_CELL_CLASS = "w-20 font-mono font-semibold align-middle";

/**
 * The line under every desk row naming what it is: product, type, and
 * for a counted row how many there are. A coded row's code is enough to
 * find the tag, but not to tell the officer they're handing over the
 * Corax rather than the Sitta; a counted row has no code at all, so the
 * quantity takes the first cell and this line is its only name. A second
 * `<tr>` spanning every column — the same shape as the error line —
 * rather than a wider first cell, so the column grid holds at phone
 * width.
 */
function SubjectLine({
  colSpan,
  name,
  typeName,
  detail,
  warning,
}: {
  colSpan: number;
  name: string;
  typeName: string;
  /** Counted rows only: availability, or how many were lent. */
  detail?: string;
  warning?: string | null;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      {/* `whitespace-normal` overrides the table cell's `nowrap`: a
          model name is long, and unwrapped it widens the table past
          the Sheet and shoves the remove button off-screen. */}
      <TableCell colSpan={colSpan} className="pt-0 text-xs whitespace-normal">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">
          {" "}
          · {typeName}
          {detail ? ` · ${detail}` : null}
        </span>
        {warning ? (
          <span className="mt-0.5 flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {warning}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function RowError({ colSpan, error }: { colSpan: number; error: string }) {
  return (
    <TableRow className="border-destructive/40">
      <TableCell
        colSpan={colSpan}
        className="pt-0 text-xs whitespace-normal text-destructive"
      >
        <span className="flex items-center gap-1">
          <AlertTriangle className="size-3" />
          {error}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function CheckoutItemRow({
  row,
  durationDays,
  onDurationChange,
  error,
  caveOpenWeekdays,
  onRemove,
}: {
  row: GearLookupRow;
  durationDays: number;
  onDurationChange: (days: number) => void;
  error?: string | null;
  /** ISO weekday numbers the gear cave is open; drives the picker's
   *  advisory line. See `DueDatePicker`. */
  caveOpenWeekdays?: readonly number[];
  onRemove: () => void;
}) {
  return (
    <>
      <TableRow
        title={`${row.typeName} · ${row.name}`}
        className={cn(
          "border-b-0",
          error ? "border-destructive/40" : undefined,
        )}
      >
        <TableCell className={CODE_CELL_CLASS}>{row.code}</TableCell>
        <TableCell className="align-middle">
          <DueDatePicker
            id={`due-${row.publicId}`}
            label=""
            durationDays={durationDays}
            onDurationChange={onDurationChange}
            compact
            caveOpenWeekdays={caveOpenWeekdays}
          />
        </TableCell>
        <TableCell className="w-10 align-middle">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove ${row.code}`}
          >
            <X className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
      <SubjectLine colSpan={3} name={row.name} typeName={row.typeName} />
      {error ? <RowError colSpan={3} error={error} /> : null}
    </>
  );
}

export function CheckinItemRow({
  row,
  conditionAtReturn,
  onConditionChange,
  notes,
  onNotesChange,
  error,
  onRemove,
}: {
  row: GearLookupRow;
  conditionAtReturn: GearCondition | null;
  onConditionChange: (condition: GearCondition | null) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  error?: string | null;
  onRemove: () => void;
}) {
  return (
    <>
      <TableRow
        title={`${row.typeName} · ${row.name}`}
        className={cn(
          "border-b-0",
          error ? "border-destructive/40" : undefined,
        )}
      >
        <TableCell className={CODE_CELL_CLASS}>{row.code}</TableCell>
        <TableCell className="w-44 align-middle">
          <Select
            value={conditionAtReturn ?? "__unchanged__"}
            onValueChange={(v) =>
              onConditionChange(
                v === "__unchanged__" ? null : (v as GearCondition),
              )
            }
          >
            <SelectTrigger
              id={`condition-${row.publicId}`}
              className="h-8"
              aria-label="Condition at return"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unchanged__">No change</SelectItem>
              {GEAR_CONDITION_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="w-10 align-middle">
          {/* Hover-popover with the borrower's full name. Tooltip
              wraps the avatar so keyboard focus also surfaces the
              name (Radix Tooltip handles both hover and focus). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <UserAvatar
                  avatarKey={row.openLoanMemberAvatarKey}
                  name={row.openLoanMemberFullName ?? ""}
                  className="size-7"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {row.openLoanMemberFullName ?? "Unknown borrower"}
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="align-middle">
          <div className="flex items-center justify-end gap-1">
            <CheckinNotesButton
              subject={row.code}
              notes={notes}
              onNotesChange={onNotesChange}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={`Remove ${row.code}`}
            >
              <X className="size-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <SubjectLine colSpan={4} name={row.name} typeName={row.typeName} />
      {error ? <RowError colSpan={4} error={error} /> : null}
    </>
  );
}

/**
 * Notes for one check-in row. Notes are uncommon per item, and an
 * inline Textarea per row eats vertical space — so it is an icon that
 * opens a small dialog, tinted when notes are present so the officer
 * can see at a glance which rows carry context. Shared by the coded and
 * counted rows so the two can't drift.
 */
function CheckinNotesButton({
  subject,
  notes,
  onNotesChange,
}: {
  /** What the dialog is about — a code, or "6 × BD HotForge". */
  subject: string;
  notes: string;
  onNotesChange: (notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes);
  // Re-seed the draft only on the closed→open transition. Depending on
  // `notes` here would overwrite the user's in-flight edits whenever the
  // parent re-rendered the row. The canonical value is captured through
  // a ref so the effect itself stays single-dep.
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    if (open) setDraft(notesRef.current);
  }, [open]);
  const hasNotes = notes.trim().length > 0;
  const fieldId = useId();

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={`${hasNotes ? "Edit" : "Add"} notes for ${subject}`}
      >
        <StickyNote
          className={cn(
            "size-4",
            hasNotes ? "fill-primary/30 text-primary" : undefined,
          )}
        />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notes — {subject}</DialogTitle>
            <DialogDescription>
              Optional context for this check-in (damage observed, where the
              member found a missing piece, etc.).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={fieldId} className="sr-only">
              Check-in notes
            </Label>
            <Textarea
              id={fieldId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onNotesChange(draft);
                setOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A quantity of a counted model in the checkout batch. Same three
 * columns as `CheckoutItemRow` — quantity where the code would be — so
 * a mixed batch reads as one table.
 *
 * Asking for more than `takeable` is advised against, not prevented:
 * a `gear:manage` officer may override into held units, and the server
 * is the authority on what is actually there.
 */
export function CountedCheckoutItemRow({
  model,
  quantity,
  onQuantityChange,
  durationDays,
  onDurationChange,
  error,
  caveOpenWeekdays,
  onRemove,
  autoFocus,
}: {
  model: DeskCountedModel;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  durationDays: number;
  onDurationChange: (days: number) => void;
  error?: string | null;
  caveOpenWeekdays?: readonly number[];
  onRemove: () => void;
  autoFocus?: boolean;
}) {
  const over = quantity > model.takeable;
  const detail =
    model.held > 0
      ? `${model.takeable} available · ${model.held} held`
      : `${model.takeable} available`;
  return (
    <>
      <TableRow
        title={`${model.typeName} · ${model.name}`}
        className={cn(
          "border-b-0",
          error ? "border-destructive/40" : undefined,
        )}
      >
        <TableCell className="w-20 align-middle">
          <DeskQuantityInput
            id={`qty-${model.publicId}`}
            value={quantity}
            onChange={onQuantityChange}
            max={MAX_COUNTED_LOAN_QUANTITY}
            label={`Quantity of ${model.name}`}
            autoFocus={autoFocus}
            invalid={over}
          />
        </TableCell>
        <TableCell className="align-middle">
          <DueDatePicker
            id={`due-${model.publicId}`}
            label=""
            durationDays={durationDays}
            onDurationChange={onDurationChange}
            compact
            caveOpenWeekdays={caveOpenWeekdays}
          />
        </TableCell>
        <TableCell className="w-10 align-middle">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove ${model.name}`}
          >
            <X className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
      <SubjectLine
        colSpan={3}
        name={model.name}
        typeName={model.typeName}
        detail={detail}
        warning={
          over && !error ? `Only ${model.takeable} available` : undefined
        }
      />
      {error ? <RowError colSpan={3} error={error} /> : null}
    </>
  );
}

/**
 * Units coming back on one open counted loan. Prefilled to everything
 * still out — "all six came back" is the common case — and capped
 * there, since the server refuses more.
 */
export function CountedCheckinItemRow({
  loan,
  quantity,
  onQuantityChange,
  notes,
  onNotesChange,
  error,
  onRemove,
  autoFocus,
}: {
  loan: DeskCountedLoan;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  error?: string | null;
  onRemove: () => void;
  autoFocus?: boolean;
}) {
  const short = loan.outstanding - quantity;
  return (
    <>
      <TableRow
        title={`${loan.typeName} · ${loan.name}`}
        className={cn(
          "border-b-0",
          error ? "border-destructive/40" : undefined,
        )}
      >
        <TableCell className="w-20 align-middle">
          <DeskQuantityInput
            id={`return-${loan.loanPublicId}`}
            value={quantity}
            onChange={onQuantityChange}
            max={loan.outstanding}
            label={`Units of ${loan.name} returned`}
            autoFocus={autoFocus}
          />
        </TableCell>
        <TableCell className="w-44 align-middle text-sm text-muted-foreground">
          of {loan.outstanding} out
        </TableCell>
        <TableCell className="w-10 align-middle">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <UserAvatar
                  avatarKey={loan.memberAvatarKey}
                  name={loan.memberFullName}
                  className="size-7"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{loan.memberFullName}</TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="align-middle">
          <div className="flex items-center justify-end gap-1">
            <CheckinNotesButton
              subject={`${loan.outstanding} × ${loan.name}`}
              notes={notes}
              onNotesChange={onNotesChange}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={`Remove ${loan.name}`}
            >
              <X className="size-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <SubjectLine
        colSpan={4}
        name={loan.name}
        typeName={loan.typeName}
        detail={`${loan.quantity} lent`}
        // Said out loud because it is the consequence the officer might
        // not expect: a short return does not close the loan.
        warning={
          short > 0 && !error
            ? `${short} still out — the loan stays open for ${short === 1 ? "it" : "them"}`
            : undefined
        }
      />
      {error ? <RowError colSpan={4} error={error} /> : null}
    </>
  );
}

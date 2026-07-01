import { AlertTriangle, StickyNote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { DueDatePicker } from "#/features/gear/components/due-date-picker";
import { cn } from "#/lib/utils";
import { GEAR_CONDITION_VALUES } from "#/features/gear/server/gear-fns";
import type {
  GearCondition,
  GearLookupRow,
} from "#/features/gear/server/gear-fns";

/**
 * Row components for the gear-desk items table. The parent pane owns
 * the surrounding `<Table>`/`<TableHeader>`; each row here renders one
 * or two `<TableRow>`s — the second only when there's a per-row error,
 * which sits beneath the controls so the column grid stays intact.
 *
 * Table (vs. the shadcn `Item` primitive) buys real column alignment
 * for free: `<thead>` sets the column widths once and every `<tr>`
 * inherits them.
 */

const CODE_CELL_CLASS = "w-20 font-mono font-semibold align-middle";

export function CheckoutItemRow({
  row,
  durationDays,
  onDurationChange,
  error,
  onRemove,
}: {
  row: GearLookupRow;
  durationDays: number;
  onDurationChange: (days: number) => void;
  error?: string | null;
  onRemove: () => void;
}) {
  return (
    <>
      <TableRow
        title={`${row.typeName} · ${row.description}`}
        className={error ? "border-destructive/40" : undefined}
      >
        <TableCell className={CODE_CELL_CLASS}>{row.code}</TableCell>
        <TableCell className="align-middle">
          <DueDatePicker
            id={`due-${row.publicId}`}
            label=""
            durationDays={durationDays}
            onDurationChange={onDurationChange}
            compact
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
      {error ? (
        <TableRow className="border-destructive/40">
          <TableCell colSpan={3} className="pt-0 text-xs text-destructive">
            <span className="flex items-center gap-1">
              <AlertTriangle className="size-3" />
              {error}
            </span>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

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
  // Notes are an uncommon thing per item (most check-ins don't need
  // them). Inlining a Textarea per row eats vertical space; instead
  // we put a notes-icon button in the actions cell that opens a small
  // dialog. The icon tints when notes are present so the officer can
  // see at a glance which rows carry context.
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState(notes);
  // Re-seed the draft only on the closed→open transition. Depending on
  // `notes` here would overwrite the user's in-flight edits whenever the
  // parent's `onNotesChange` (or any sibling state) re-rendered the row.
  // The canonical value is captured by reading the latest `notes` via a
  // ref so the effect itself stays single-dep.
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    if (notesOpen) setDraft(notesRef.current);
  }, [notesOpen]);
  const hasNotes = notes.trim().length > 0;
  const saveNotes = () => {
    onNotesChange(draft);
    setNotesOpen(false);
  };

  return (
    <>
      <TableRow
        title={`${row.typeName} · ${row.description}`}
        className={error ? "border-destructive/40" : undefined}
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setNotesOpen(true)}
              aria-label={`${hasNotes ? "Edit" : "Add"} notes for ${row.code}`}
            >
              <StickyNote
                className={cn(
                  "size-4",
                  hasNotes ? "fill-primary/30 text-primary" : undefined,
                )}
              />
            </Button>
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
      {error ? (
        <TableRow className="border-destructive/40">
          <TableCell colSpan={4} className="pt-0 text-xs text-destructive">
            <span className="flex items-center gap-1">
              <AlertTriangle className="size-3" />
              {error}
            </span>
          </TableCell>
        </TableRow>
      ) : null}

      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notes — {row.code}</DialogTitle>
            <DialogDescription>
              Optional context for this check-in (damage observed, where the
              member found a missing piece, etc.).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`notes-${row.publicId}`} className="sr-only">
              Check-in notes
            </Label>
            <Textarea
              id={`notes-${row.publicId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveNotes}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

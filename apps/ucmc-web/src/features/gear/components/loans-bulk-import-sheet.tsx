/**
 * Backfill sheet for historical gear loans. Mirrors the structure of
 * `gear-bulk-import-sheet.tsx`:
 *
 *   1. Type rows manually — member email, gear code, dates, optional
 *      returned-at and condition. "Add row" appends.
 *   2. Import a CSV file OR paste from the clipboard. The parser
 *      merges results into the dynamic rows above any already-typed
 *      entries.
 *
 * Per-row validation is light (required fields populated, ISO date
 * shape, email shape, condition only on returned rows). The server is
 * the source of truth for cross-row constraints — submitting returns
 * `{ created, skipped }` so we can render which rows were dropped.
 */
import { ClipboardPaste, Plus, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useBulkImportLoans } from "#/features/gear/api/use-bulk-import-loans";
import { parseLoansCsv } from "#/features/gear/lib/parse-loans-csv";
import type {
  ParsedLoanRow,
  ParseLoansCsvError,
} from "#/features/gear/lib/parse-loans-csv";
import type {
  BulkImportLoansResult,
  BulkImportLoanSkipped,
  GearCondition,
} from "#/features/gear/server/gear-fns";

const MAX_ROWS = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CONDITION_OPTIONS: { value: GearCondition; label: string }[] = [
  { value: "serviceable", label: "Serviceable" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "missing", label: "Missing" },
  { value: "lost", label: "Lost" },
];

interface RowState {
  /** Stable key so React doesn't remount inputs as the array shifts. */
  key: string;
  memberEmail: string;
  gearCode: string;
  checkedOutAt: string;
  dueAt: string;
  returnedAt: string;
  conditionAtReturn: GearCondition | "";
  checkoutNotes: string;
  checkinNotes: string;
}

function makeRow(initial: Partial<RowState> = {}): RowState {
  return {
    key: crypto.randomUUID(),
    memberEmail: initial.memberEmail ?? "",
    gearCode: initial.gearCode ?? "",
    checkedOutAt: initial.checkedOutAt ?? "",
    dueAt: initial.dueAt ?? "",
    returnedAt: initial.returnedAt ?? "",
    conditionAtReturn: initial.conditionAtReturn ?? "",
    checkoutNotes: initial.checkoutNotes ?? "",
    checkinNotes: initial.checkinNotes ?? "",
  };
}

function rowHasContent(row: RowState): boolean {
  return (
    row.memberEmail.trim().length > 0 ||
    row.gearCode.trim().length > 0 ||
    row.checkedOutAt.length > 0 ||
    row.dueAt.length > 0 ||
    row.returnedAt.length > 0 ||
    row.conditionAtReturn.length > 0 ||
    row.checkoutNotes.trim().length > 0 ||
    row.checkinNotes.trim().length > 0
  );
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function rowIsValid(row: RowState): boolean {
  // Required fields populated + plausibly shaped.
  if (!EMAIL_RE.test(row.memberEmail.trim())) return false;
  if (row.gearCode.trim().length === 0) return false;
  if (!isIsoDate(row.checkedOutAt)) return false;
  if (row.dueAt.length > 0 && !isIsoDate(row.dueAt)) return false;
  if (row.returnedAt.length > 0 && !isIsoDate(row.returnedAt)) return false;
  // Date ordering — surface client-side so the server doesn't have to
  // skip it as `invalid_dates`.
  if (row.dueAt.length > 0 && row.dueAt < row.checkedOutAt) return false;
  if (row.returnedAt.length > 0 && row.returnedAt < row.checkedOutAt)
    return false;
  // condition_at_return only makes sense for returned rows.
  if (row.conditionAtReturn.length > 0 && row.returnedAt.length === 0)
    return false;
  if (row.checkinNotes.trim().length > 0 && row.returnedAt.length === 0)
    return false;
  return true;
}

interface ImportSummary {
  imported: number;
  errors: ParseLoansCsvError[];
  truncated: boolean;
}

export interface LoansBulkImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoansBulkImportSheet({
  open,
  onOpenChange,
}: LoansBulkImportSheetProps) {
  const [rows, setRows] = useState<RowState[]>(() => [makeRow()]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [submitResult, setSubmitResult] =
    useState<BulkImportLoansResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputId = useId();

  const bulkImport = useBulkImportLoans();

  const validRows = rows.filter(rowIsValid);
  const populatedRows = rows.filter(rowHasContent);
  const canSubmit =
    !bulkImport.isPending &&
    validRows.length > 0 &&
    validRows.length === populatedRows.length;

  function reset() {
    setRows([makeRow()]);
    setImportSummary(null);
    setSubmitResult(null);
    setImportError(null);
    setSubmitError(null);
  }

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(reset, 200);
    }
  }

  function updateRow(index: number, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, makeRow()]));
  }

  function removeRow(index: number) {
    setRows((prev) => {
      if (prev.length === 1) return [makeRow()];
      return prev.filter((_, i) => i !== index);
    });
  }

  function applyParsed(parsed: {
    rows: ParsedLoanRow[];
    errors: ParseLoansCsvError[];
  }) {
    setRows((prev) => {
      const existing = prev.filter(rowHasContent);
      const incoming = parsed.rows.map((r) =>
        makeRow({
          memberEmail: r.memberEmail,
          gearCode: r.gearCode,
          checkedOutAt: r.checkedOutAt,
          dueAt: r.dueAt ?? "",
          returnedAt: r.returnedAt ?? "",
          conditionAtReturn: r.conditionAtReturn ?? "",
          checkoutNotes: r.checkoutNotes ?? "",
          checkinNotes: r.checkinNotes ?? "",
        }),
      );
      const merged = [...existing, ...incoming];
      const truncated = merged.length > MAX_ROWS;
      const limited = merged.slice(0, MAX_ROWS);
      const final = limited.length > 0 ? limited : [makeRow()];
      setImportSummary({
        imported: Math.min(parsed.rows.length, MAX_ROWS - existing.length),
        errors: parsed.errors,
        truncated,
      });
      return final;
    });
  }

  async function handleFileImport(file: File) {
    setImportError(null);
    try {
      const result = await parseLoansCsv(file);
      applyParsed(result);
    } catch {
      setImportError(
        "Couldn't read that file. Make sure it's a CSV and try again.",
      );
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleClipboardImport() {
    setImportError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().length === 0) {
        setImportError("Clipboard is empty.");
        return;
      }
      const result = await parseLoansCsv(text);
      applyParsed(result);
    } catch {
      setImportError(
        "Couldn't read from clipboard. Copy your CSV again and try once more, or use the file picker.",
      );
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitResult(null);
    const payload = validRows.map((row) => ({
      memberEmail: row.memberEmail.trim(),
      gearCode: row.gearCode.trim(),
      checkedOutAt: row.checkedOutAt,
      dueAt: row.dueAt.length === 0 ? null : row.dueAt,
      returnedAt: row.returnedAt.length === 0 ? null : row.returnedAt,
      conditionAtReturn:
        row.conditionAtReturn === "" ? null : row.conditionAtReturn,
      checkoutNotes:
        row.checkoutNotes.trim().length === 0 ? null : row.checkoutNotes.trim(),
      checkinNotes:
        row.checkinNotes.trim().length === 0 ? null : row.checkinNotes.trim(),
    }));
    try {
      const result = await bulkImport.mutateAsync({ rows: payload });
      setSubmitResult(result);
      const createdIndexes = new Set(result.created.map((c) => c.rowIndex));
      setRows((prev) => {
        const validKeyOrder = validRows.map((r) => r.key);
        const remaining = prev.filter((row) => {
          const vi = validKeyOrder.indexOf(row.key);
          return vi === -1 || !createdIndexes.has(vi);
        });
        return remaining.length > 0 ? remaining : [makeRow()];
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Couldn't import loans",
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>Backfill loans</SheetTitle>
          <SheetDescription>
            Migrate historical checkouts (paper logbook, old spreadsheet) into
            the system. Member email + gear code + checked_out_at are required;
            fill returned_at to record an already-closed loan.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* CSV import */}
          <div className="rounded-md border bg-muted/30 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={csvInputId} className="text-sm font-medium">
                Import from CSV
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleClipboardImport()}
                >
                  <ClipboardPaste className="size-4" />
                  Paste
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-4" />
                  Choose file
                </Button>
              </div>
              <input
                ref={fileInputRef}
                id={csvInputId}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileImport(file);
                }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Columns: member_email, gear_code, checked_out_at (YYYY-MM-DD),
              due_at, returned_at, condition_at_return, checkout_notes,
              checkin_notes. Header row optional.
            </p>
            {importSummary ? (
              <div className="mt-2 text-xs">
                <p>
                  Imported <strong>{importSummary.imported}</strong> row
                  {importSummary.imported === 1 ? "" : "s"}.{" "}
                  {importSummary.errors.length > 0
                    ? `${importSummary.errors.length} skipped.`
                    : null}
                </p>
                {importSummary.truncated ? (
                  <p className="text-amber-600">
                    Capped at {MAX_ROWS} rows per submit.
                  </p>
                ) : null}
                {importSummary.errors.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {importSummary.errors.slice(0, 5).map((err) => (
                      <li key={`${err.line}:${err.message}`}>
                        Line {err.line}: {err.message}
                      </li>
                    ))}
                    {importSummary.errors.length > 5 ? (
                      <li>…and {importSummary.errors.length - 5} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {importError ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {importError}
              </p>
            ) : null}
          </div>

          {/* Submit feedback */}
          {submitError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t backfill loans</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          {submitResult ? (
            <Alert>
              <AlertTitle>
                {submitResult.created.length} created,{" "}
                {submitResult.skipped.length} skipped
              </AlertTitle>
              {submitResult.skipped.length > 0 ? (
                <AlertDescription>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {submitResult.skipped.map((s) => (
                      <li key={`${s.rowIndex}-${s.reason}`}>
                        Row {s.rowIndex + 1}: {skippedLabel(s)}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}

          {/* Dynamic rows */}
          <div className="space-y-3">
            {rows.map((row, index) => (
              <LoanImportRow
                key={row.key}
                row={row}
                index={index}
                onChange={(patch) => updateRow(index, patch)}
                onRemove={() => removeRow(index)}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={rows.length >= MAX_ROWS}
            >
              <Plus className="size-4" />
              Add row
            </Button>
            {rows.length >= MAX_ROWS ? (
              <p className="text-xs text-muted-foreground">
                Reached the {MAX_ROWS}-row limit.
              </p>
            ) : null}
          </div>
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={bulkImport.isPending}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {bulkImport.isPending
              ? "Importing…"
              : validRows.length > 0
                ? `Import (${validRows.length})`
                : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function LoanImportRow({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: RowState;
  index: number;
  onChange: (patch: Partial<RowState>) => void;
  onRemove: () => void;
}) {
  const returnedFilled = row.returnedAt.length > 0;
  return (
    <div
      data-testid="loan-import-row"
      className="flex items-start gap-2 rounded-md border p-2"
    >
      <div className="grid flex-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-1">
          <Label className="text-xs" htmlFor={`email-${row.key}`}>
            Member email
            <span className="text-destructive" aria-hidden>
              {" *"}
            </span>
          </Label>
          <Input
            id={`email-${row.key}`}
            type="email"
            value={row.memberEmail}
            onChange={(e) => onChange({ memberEmail: e.target.value })}
            placeholder="member@example.com"
            maxLength={254}
            required
            aria-required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`code-${row.key}`}>
            Gear code
            <span className="text-destructive" aria-hidden>
              {" *"}
            </span>
          </Label>
          <Input
            id={`code-${row.key}`}
            value={row.gearCode}
            onChange={(e) => onChange({ gearCode: e.target.value })}
            placeholder="CH1"
            maxLength={64}
            required
            aria-required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`checkedOut-${row.key}`}>
            Checked out
            <span className="text-destructive" aria-hidden>
              {" *"}
            </span>
          </Label>
          <Input
            id={`checkedOut-${row.key}`}
            type="date"
            value={row.checkedOutAt}
            onChange={(e) => onChange({ checkedOutAt: e.target.value })}
            required
            aria-required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`due-${row.key}`}>
            Due
          </Label>
          <Input
            id={`due-${row.key}`}
            type="date"
            value={row.dueAt}
            onChange={(e) => onChange({ dueAt: e.target.value })}
            placeholder="defaults to +7d"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`returned-${row.key}`}>
            Returned
          </Label>
          <Input
            id={`returned-${row.key}`}
            type="date"
            value={row.returnedAt}
            onChange={(e) => {
              const next: Partial<RowState> = { returnedAt: e.target.value };
              if (e.target.value.length === 0) {
                next.conditionAtReturn = "";
                next.checkinNotes = "";
              }
              onChange(next);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`condition-${row.key}`}>
            Condition at return
          </Label>
          <Select
            value={row.conditionAtReturn}
            onValueChange={(v) =>
              onChange({ conditionAtReturn: v as GearCondition })
            }
            disabled={!returnedFilled}
          >
            <SelectTrigger id={`condition-${row.key}`} className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label className="text-xs" htmlFor={`out-notes-${row.key}`}>
            Checkout notes
          </Label>
          <Input
            id={`out-notes-${row.key}`}
            value={row.checkoutNotes}
            onChange={(e) => onChange({ checkoutNotes: e.target.value })}
            maxLength={2000}
            placeholder="Trip to Red River Gorge"
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label className="text-xs" htmlFor={`in-notes-${row.key}`}>
            Check-in notes
          </Label>
          <Input
            id={`in-notes-${row.key}`}
            value={row.checkinNotes}
            onChange={(e) => onChange({ checkinNotes: e.target.value })}
            maxLength={2000}
            disabled={!returnedFilled}
            placeholder={
              returnedFilled ? "Returned with frayed strap" : "(returned only)"
            }
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-5 size-8 text-muted-foreground"
        onClick={onRemove}
        aria-label={`Remove row ${index + 1}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function skippedLabel(s: BulkImportLoanSkipped): string {
  switch (s.reason) {
    case "member_not_found":
      return `member "${s.memberEmail}" not found (pre-add first?)`;
    case "gear_not_found":
      return `gear code "${s.gearCode}" not found`;
    case "already_on_loan":
      return `gear ${s.gearCode} already has an open loan`;
    case "invalid_dates":
      return "invalid or out-of-order dates";
    case "duplicate_in_import":
      return `gear ${s.gearCode} appears twice as an open loan in this import`;
    default:
      return "skipped";
  }
}

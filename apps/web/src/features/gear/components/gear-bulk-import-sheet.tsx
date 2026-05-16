/**
 * Bulk pre-add sheet for officer-imported gear. Mirrors the structure
 * of `pre-add-unclaimed-sheet.tsx`:
 *
 *   1. Type rows manually — pick a type, fill optional fields per row,
 *      "Add row" appends.
 *   2. Import a CSV file OR paste from the clipboard. The parser merges
 *      results into the dynamic rows above any already-typed entries.
 *
 * Per-row validation is light (type required, cost is a non-negative
 * number, acquired_at is a valid date if present). The server is the
 * source of truth for code uniqueness — submitting returns
 * `{ created, skipped }` so we can render which codes collided.
 */
import { useQuery } from "@tanstack/react-query";
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
import { gearTypesQueryOptions } from "#/features/gear/api/queries";
import { useBulkImportGear } from "#/features/gear/api/use-bulk-import-gear";
import { parseGearCsv } from "#/features/gear/lib/parse-gear-csv";
import type {
  ParseGearCsvError,
  ParsedGearRow,
} from "#/features/gear/lib/parse-gear-csv";
import { GEAR_CONDITION_GRADE_VALUES } from "#/features/gear/server/gear-fns";
import type {
  BulkImportResult,
  BulkImportSkipped,
  GearConditionGrade,
  GearTypeSummary,
} from "#/features/gear/server/gear-fns";

const MAX_ROWS = 200;

// Sentinel for the condition-grade `<Select>` — same trick as the
// singular gear form, since shadcn's Select can't take an empty value.
const CONDITION_GRADE_NONE = "__none__";

const CONDITION_GRADE_LABEL: Record<GearConditionGrade, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
};

interface RowState {
  /** Stable key so React doesn't remount inputs as the array shifts. */
  key: string;
  typePublicId: string;
  code: string;
  description: string;
  /** YYYY-MM-DD string (matches `<input type="date">`). */
  acquiredAt: string;
  /** Dollar amount as typed, e.g. "60.00". Converted to cents at submit. */
  costDollars: string;
  /** Dollar amount as typed. Converted to cents at submit. */
  msrpDollars: string;
  manufacturer: string;
  serialNumber: string;
  conditionGrade: GearConditionGrade | typeof CONDITION_GRADE_NONE;
  /** Raw comma-separated text. Split + trimmed at submit. */
  tagsInput: string;
}

function makeRow(initial: Partial<RowState> = {}): RowState {
  return {
    key: crypto.randomUUID(),
    typePublicId: initial.typePublicId ?? "",
    code: initial.code ?? "",
    description: initial.description ?? "",
    acquiredAt: initial.acquiredAt ?? "",
    costDollars: initial.costDollars ?? "",
    msrpDollars: initial.msrpDollars ?? "",
    manufacturer: initial.manufacturer ?? "",
    serialNumber: initial.serialNumber ?? "",
    conditionGrade: initial.conditionGrade ?? CONDITION_GRADE_NONE,
    tagsInput: initial.tagsInput ?? "",
  };
}

function splitTagsInput(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function rowHasContent(row: RowState): boolean {
  return (
    row.typePublicId.length > 0 ||
    row.code.trim().length > 0 ||
    row.description.trim().length > 0 ||
    row.acquiredAt.length > 0 ||
    row.costDollars.trim().length > 0 ||
    row.msrpDollars.trim().length > 0 ||
    row.manufacturer.trim().length > 0 ||
    row.serialNumber.trim().length > 0 ||
    row.conditionGrade !== CONDITION_GRADE_NONE ||
    row.tagsInput.trim().length > 0
  );
}

function rowIsValid(row: RowState): boolean {
  // Type and description are required. Code, acquired, and cost are
  // optional per row. Cost must parse if present.
  if (row.typePublicId.length === 0) return false;
  if (row.description.trim().length === 0) return false;
  if (row.costDollars.trim().length > 0) {
    const n = Number(row.costDollars);
    if (!Number.isFinite(n) || n < 0) return false;
  }
  if (row.msrpDollars.trim().length > 0) {
    const n = Number(row.msrpDollars);
    if (!Number.isFinite(n) || n < 0) return false;
  }
  if (row.acquiredAt.length > 0) {
    const ms = Date.parse(`${row.acquiredAt}T00:00:00Z`);
    if (Number.isNaN(ms)) return false;
  }
  return true;
}

interface ImportSummary {
  imported: number;
  errors: ParseGearCsvError[];
  truncated: boolean;
}

function msToIso(ms: number): string {
  const d = new Date(ms);
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

export interface GearBulkImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GearBulkImportSheet({
  open,
  onOpenChange,
}: GearBulkImportSheetProps) {
  const { data: types } = useQuery(gearTypesQueryOptions());
  const [rows, setRows] = useState<RowState[]>(() => [makeRow()]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [submitResult, setSubmitResult] = useState<BulkImportResult | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputId = useId();

  const bulkImport = useBulkImportGear();

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
      if (prev.length === 1) {
        return [makeRow()];
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function applyParsed(parsed: {
    rows: ParsedGearRow[];
    errors: ParseGearCsvError[];
  }) {
    setRows((prev) => {
      const existing = prev.filter(rowHasContent);
      const incoming = parsed.rows.map((r) =>
        makeRow({
          typePublicId: r.typePublicId,
          code: r.code ?? "",
          description: r.description,
          acquiredAt: r.acquiredAt !== null ? msToIso(r.acquiredAt) : "",
          costDollars:
            r.acquisitionCostCents !== null
              ? (r.acquisitionCostCents / 100).toFixed(2)
              : "",
          msrpDollars:
            r.msrpCents !== null ? (r.msrpCents / 100).toFixed(2) : "",
          manufacturer: r.manufacturer ?? "",
          serialNumber: r.serialNumber ?? "",
          conditionGrade: r.conditionGrade ?? CONDITION_GRADE_NONE,
          tagsInput: r.tagNames.join(", "),
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
      const result = await parseGearCsv(file, types ?? []);
      applyParsed(result);
    } catch {
      setImportError(
        "Couldn't read that file. Make sure it's a CSV and try again.",
      );
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleClipboardImport() {
    setImportError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().length === 0) {
        setImportError("Clipboard is empty.");
        return;
      }
      const result = await parseGearCsv(text, types ?? []);
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
      typePublicId: row.typePublicId,
      code: row.code.trim().length === 0 ? null : row.code.trim(),
      // rowIsValid guarantees a non-empty description here.
      description: row.description.trim(),
      acquiredAt:
        row.acquiredAt.length === 0
          ? null
          : Date.parse(`${row.acquiredAt}T00:00:00Z`),
      acquisitionCostCents:
        row.costDollars.trim().length === 0
          ? null
          : Math.round(Number(row.costDollars) * 100),
      msrpCents:
        row.msrpDollars.trim().length === 0
          ? null
          : Math.round(Number(row.msrpDollars) * 100),
      manufacturer:
        row.manufacturer.trim().length === 0 ? null : row.manufacturer.trim(),
      serialNumber:
        row.serialNumber.trim().length === 0 ? null : row.serialNumber.trim(),
      conditionGrade:
        row.conditionGrade === CONDITION_GRADE_NONE ? null : row.conditionGrade,
      tagNames: splitTagsInput(row.tagsInput),
    }));
    try {
      const result = await bulkImport.mutateAsync({ rows: payload });
      setSubmitResult(result);
      // Drop successfully-created rows; keep skipped ones (by rowIndex)
      // so the officer can correct + retry, plus any blanks at the end.
      const createdIndexes = new Set(result.created.map((c) => c.rowIndex));
      setRows((prev) => {
        const validKeyOrder = validRows.map((r) => r.key);
        const remaining = prev.filter((row) => {
          const vi = validKeyOrder.indexOf(row.key);
          // Non-valid rows (blanks, half-filled) stay so the user can
          // finish them. Valid rows survive only if their submit slot
          // didn't land in `created`.
          return vi === -1 || !createdIndexes.has(vi);
        });
        return remaining.length > 0 ? remaining : [makeRow()];
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Couldn't import gear",
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>Bulk import gear</SheetTitle>
          <SheetDescription>
            Add many pieces in one go. Pick a type per row (the only required
            field) and fill optional details. Import from a CSV or clipboard to
            populate the rows quickly.
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
                  if (file) {
                    void handleFileImport(file);
                  }
                }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Columns: type (name or prefix, required), code, description,
              acquired_at (YYYY-MM-DD), cost. Money cells are always read as
              dollars (60 and 60.00 both = $60.00). Header row optional.
              Header-only extras: manufacturer, serial_number, msrp,
              condition_grade (excellent|good|fair), tags (comma-separated
              names). Tags must already exist — create canonical names in the
              Tags dialog first.
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
              <AlertTitle>Couldn&apos;t import gear</AlertTitle>
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
              <GearImportRow
                key={row.key}
                row={row}
                index={index}
                types={types ?? []}
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

function GearImportRow({
  row,
  index,
  types,
  onChange,
  onRemove,
}: {
  row: RowState;
  index: number;
  types: GearTypeSummary[];
  onChange: (patch: Partial<RowState>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-testid="gear-import-row"
      className="flex items-start gap-2 rounded-md border p-2"
    >
      <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`type-${row.key}`}>
            Type
          </Label>
          <Select
            value={row.typePublicId}
            onValueChange={(v) => onChange({ typePublicId: v })}
          >
            <SelectTrigger id={`type-${row.key}`} className="h-9">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.publicId} value={t.publicId}>
                  {t.name}
                  {t.prefix ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {t.prefix}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`code-${row.key}`}>
            Code
          </Label>
          <Input
            id={`code-${row.key}`}
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="CH93"
            maxLength={64}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label className="text-xs" htmlFor={`description-${row.key}`}>
            Description
            <span className="text-destructive" aria-hidden>
              {" *"}
            </span>
          </Label>
          <Input
            id={`description-${row.key}`}
            value={row.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Black Diamond Momentum, size M"
            maxLength={500}
            required
            aria-required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`manufacturer-${row.key}`}>
            Manufacturer
          </Label>
          <Input
            id={`manufacturer-${row.key}`}
            value={row.manufacturer}
            onChange={(e) => onChange({ manufacturer: e.target.value })}
            placeholder="Petzl"
            maxLength={100}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`serial-${row.key}`}>
            Serial number
          </Label>
          <Input
            id={`serial-${row.key}`}
            value={row.serialNumber}
            onChange={(e) => onChange({ serialNumber: e.target.value })}
            placeholder="ABC-12345"
            maxLength={100}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`acquired-${row.key}`}>
            Acquired
          </Label>
          <Input
            id={`acquired-${row.key}`}
            type="date"
            value={row.acquiredAt}
            onChange={(e) => onChange({ acquiredAt: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`grade-${row.key}`}>
            Condition grade
          </Label>
          <Select
            value={row.conditionGrade}
            onValueChange={(v) =>
              onChange({
                conditionGrade: v as
                  | GearConditionGrade
                  | typeof CONDITION_GRADE_NONE,
              })
            }
          >
            <SelectTrigger id={`grade-${row.key}`} className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CONDITION_GRADE_NONE}>
                <span className="text-muted-foreground">No grade</span>
              </SelectItem>
              {GEAR_CONDITION_GRADE_VALUES.map((g) => (
                <SelectItem key={g} value={g}>
                  {CONDITION_GRADE_LABEL[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`cost-${row.key}`}>
            Cost (USD)
          </Label>
          <Input
            id={`cost-${row.key}`}
            type="number"
            step="0.01"
            min="0"
            value={row.costDollars}
            onChange={(e) => onChange({ costDollars: e.target.value })}
            placeholder="60.00"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`msrp-${row.key}`}>
            MSRP (USD)
          </Label>
          <Input
            id={`msrp-${row.key}`}
            type="number"
            step="0.01"
            min="0"
            value={row.msrpDollars}
            onChange={(e) => onChange({ msrpDollars: e.target.value })}
            placeholder="84.95"
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label className="text-xs" htmlFor={`tags-${row.key}`}>
            Tags
          </Label>
          <Input
            id={`tags-${row.key}`}
            value={row.tagsInput}
            onChange={(e) => onChange({ tagsInput: e.target.value })}
            placeholder="color:red, size:m"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated names. Must already exist in the Tags dialog.
          </p>
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

function skippedLabel(s: BulkImportSkipped): string {
  switch (s.reason) {
    case "type_not_found":
      return `unknown type${s.code ? ` (would have been ${s.code})` : ""}`;
    case "code_in_use":
      return `code "${s.code ?? ""}" already in use`;
    case "code_duplicate_in_import":
      return `code "${s.code ?? ""}" appears twice in this import`;
    case "missing_description":
      return "description is required";
    case "tag_not_found": {
      const list =
        s.missingTags && s.missingTags.length > 0
          ? ` (${s.missingTags.join(", ")})`
          : "";
      return `unknown tag${list} — create it in the Tags dialog first`;
    }
    case "invalid":
      return "invalid";
    default:
      return "skipped";
  }
}

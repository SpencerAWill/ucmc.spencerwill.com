/**
 * Bulk pre-add sheet for officer-imported "unclaimed" members.
 *
 * Two ways to fill in entries:
 *   1. Type rows manually — name + email per row, "Add row" appends.
 *   2. Import a CSV file (Name, Email columns) — parsed client-side via
 *      `parseUnclaimedCsv` and merged into the dynamic rows above any
 *      already-typed entries.
 *
 * Per-row validation is light (non-empty, looks-like-email). The server
 * is the source of truth for uniqueness; submitting returns
 * `{ created, skipped }` so we can render which addresses already
 * belonged to someone.
 */
import { ClipboardPaste, Plus, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { usePreAddUnclaimed } from "#/features/members/api/use-pre-add-unclaimed";
import { parseUnclaimedCsv } from "#/features/members/lib/parse-unclaimed-csv";
import type {
  ParseUnclaimedCsvError,
  ParsedUnclaimedRow,
} from "#/features/members/lib/parse-unclaimed-csv";
import type { PreAddResult } from "#/features/members/server/member-fns";

const MAX_ROWS = 200;

interface RowState {
  /** Stable key so React doesn't remount inputs as the array shifts. */
  key: string;
  name: string;
  email: string;
}

function makeRow(name = "", email = ""): RowState {
  return {
    key: crypto.randomUUID(),
    name,
    email,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rowHasContent(row: RowState): boolean {
  return row.name.trim().length > 0 || row.email.trim().length > 0;
}

function rowIsValid(row: RowState): boolean {
  return row.name.trim().length > 0 && EMAIL_RE.test(row.email.trim());
}

interface ImportSummary {
  imported: number;
  errors: Array<{ line: number; message: string }>;
  truncated: boolean;
}

export interface PreAddUnclaimedSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreAddUnclaimedSheet({
  open,
  onOpenChange,
}: PreAddUnclaimedSheetProps) {
  const [rows, setRows] = useState<RowState[]>(() => [makeRow()]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [submitResult, setSubmitResult] = useState<PreAddResult | null>(null);
  // Two distinct error slots so the message in each alert can be
  // accurate to its cause: import errors come from CSV / clipboard
  // parsing (file picker, paste), submit errors come from the
  // `preAddUnclaimedFn` mutation. Using one slot would mean a clipboard
  // failure displayed under the submit-error heading and vice-versa.
  const [importError, setImportError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputId = useId();

  const preAdd = usePreAddUnclaimed();

  const validRows = rows.filter(rowIsValid);
  const populatedRows = rows.filter(rowHasContent);
  const canSubmit =
    !preAdd.isPending &&
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
      // Defer the reset so the closing transition finishes against the
      // current state rather than empty.
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
        // Always keep at least one (cleared) row in the UI so the sheet
        // never appears empty.
        return [makeRow()];
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function applyParsed(parsed: {
    rows: ParsedUnclaimedRow[];
    errors: ParseUnclaimedCsvError[];
  }) {
    setRows((prev) => {
      const existing = prev.filter(rowHasContent);
      const incoming = parsed.rows.map((r) => makeRow(r.name, r.email));
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
      const result = await parseUnclaimedCsv(file);
      applyParsed(result);
    } catch {
      setImportError(
        "Couldn't read that file. Make sure it's a CSV and try again.",
      );
    }
    // Allow re-importing the same file (browsers ignore unchanged value).
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleClipboardImport() {
    setImportError(null);
    try {
      // Most modern browsers gate `navigator.clipboard.readText()`
      // behind a permission prompt the first time per origin. The user
      // gesture (button click) satisfies the transient activation
      // requirement; the rejection path covers denied permission +
      // clipboard-API-unavailable cases (insecure context, Firefox
      // without the experimental flag, etc.) with a clear message.
      const text = await navigator.clipboard.readText();
      if (text.trim().length === 0) {
        setImportError("Clipboard is empty.");
        return;
      }
      const result = await parseUnclaimedCsv(text);
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
    const entries = validRows.map((row) => ({
      name: row.name.trim(),
      email: row.email.trim().toLowerCase(),
    }));
    try {
      const result = await preAdd.mutateAsync({ entries });
      setSubmitResult(result);
      // Drop successfully-created rows; keep skipped ones so the
      // officer can edit + retry, alongside any blanks.
      const createdEmails = new Set(result.created.map((c) => c.email));
      setRows((prev) => {
        const remaining = prev.filter((row) => {
          const e = row.email.trim().toLowerCase();
          return !createdEmails.has(e);
        });
        return remaining.length > 0 ? remaining : [makeRow()];
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not pre-add members",
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Pre-add unclaimed members</SheetTitle>
          <SheetDescription>
            Add real-world members who haven&apos;t signed in yet so gear and
            other records can reference them. They&apos;ll claim the account by
            clicking their first magic link.
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
              Two columns: Name and Email. Header row optional.
              &ldquo;Paste&rdquo; reads CSV text from your clipboard.
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
              <AlertTitle>Couldn&apos;t pre-add members</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          {submitResult ? (
            <Alert>
              <AlertTitle>
                {submitResult.created.length} added,{" "}
                {submitResult.skipped.length} skipped
              </AlertTitle>
              {submitResult.skipped.length > 0 ? (
                <AlertDescription>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {submitResult.skipped.map((s) => (
                      <li key={s.email}>
                        {s.name} &lt;{s.email}&gt;:{" "}
                        {s.reason === "email_taken"
                          ? "email already in use"
                          : "duplicate within this batch"}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}

          {/* Dynamic rows */}
          <div className="space-y-3">
            {rows.map((row, index) => {
              const skippedReason = submitResult?.skipped.find(
                (s) => s.email.toLowerCase() === row.email.trim().toLowerCase(),
              )?.reason;
              return (
                <div
                  key={row.key}
                  className="flex items-start gap-2 rounded-md border p-2"
                >
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs" htmlFor={`name-${row.key}`}>
                        Name
                      </Label>
                      <Input
                        id={`name-${row.key}`}
                        value={row.name}
                        onChange={(e) =>
                          updateRow(index, { name: e.target.value })
                        }
                        placeholder="Alex Climber"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs" htmlFor={`email-${row.key}`}>
                        Email
                      </Label>
                      <Input
                        id={`email-${row.key}`}
                        type="email"
                        value={row.email}
                        onChange={(e) =>
                          updateRow(index, { email: e.target.value })
                        }
                        placeholder="alex@uc.edu"
                      />
                      {skippedReason === "email_taken" ? (
                        <Badge variant="destructive" className="w-fit">
                          email already in use
                        </Badge>
                      ) : skippedReason === "duplicate_in_batch" ? (
                        <Badge variant="secondary" className="w-fit">
                          duplicate
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-5 size-8 text-muted-foreground"
                    onClick={() => removeRow(index)}
                    aria-label={`Remove row ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
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
            disabled={preAdd.isPending}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {preAdd.isPending
              ? "Adding…"
              : validRows.length > 0
                ? `Pre-add (${validRows.length})`
                : "Pre-add"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

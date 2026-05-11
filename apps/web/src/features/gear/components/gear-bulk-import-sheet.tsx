import { useQuery } from "@tanstack/react-query";
import { ClipboardPaste, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import { gearTypesQueryOptions } from "#/features/gear/api/queries";
import { useBulkImportGear } from "#/features/gear/api/use-bulk-import-gear";
import { parseGearCsv } from "#/features/gear/lib/parse-gear-csv";
import type {
  BulkImportResult,
  BulkImportSkipped,
} from "#/features/gear/server/gear-fns";

type ImportSuccess = BulkImportResult;

const SAMPLE_CSV = `type,code,description,acquired_at,cost
Climbing Harness,CH1,Black Diamond Momentum size M,2024-08-20,60.00
Climbing Harness,,size L spare,,
LJ,LJ4,kids size,2024-09-01,45`;

export function GearBulkImportSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Bulk import gear</SheetTitle>
          <SheetDescription>
            Paste a CSV or upload a file. Columns: type (required, name or
            prefix), code, description, acquired_at (YYYY-MM-DD), cost. Rows
            with codes that collide are skipped — the server is the source of
            truth.
          </SheetDescription>
        </SheetHeader>
        {open ? <BulkImportForm onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function BulkImportForm({ onClose }: { onClose: () => void }) {
  const { data: types } = useQuery(gearTypesQueryOptions());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [csv, setCsv] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<ImportSuccess | null>(null);
  const mutation = useBulkImportGear();

  const onPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCsv(text);
    } catch {
      toast.error("Couldn't read clipboard. Paste manually.");
    }
  };

  const onFile = async (file: File) => {
    setCsv(await file.text());
  };

  const onSubmit = async () => {
    setSuccess(null);
    setParseErrors([]);
    const trimmed = csv.trim();
    if (trimmed.length === 0) {
      setParseErrors(["Paste a CSV or upload a file first."]);
      return;
    }
    const parsed = await parseGearCsv(trimmed, types ?? []);
    if (parsed.rows.length === 0) {
      setParseErrors(
        [
          ...parsed.errors.map((e) => `Line ${e.line}: ${e.message}`),
          parsed.errors.length === 0 ? "No valid rows found." : "",
        ].filter(Boolean),
      );
      return;
    }
    mutation.mutate(
      { rows: parsed.rows },
      {
        onSuccess: (result) => {
          const clientErrors = parsed.errors.map(
            (e) => `Line ${e.line}: ${e.message}`,
          );
          setParseErrors(clientErrors);
          setSuccess(result);
          if (result.created.length > 0) {
            toast.success(
              `Imported ${result.created.length} ${
                result.created.length === 1 ? "row" : "rows"
              }`,
            );
          }
        },
        onError: () => toast.error("Bulk import failed."),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-4" />
          Upload CSV
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={onPaste}>
          <ClipboardPaste className="size-4" />
          Paste from clipboard
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCsv(SAMPLE_CSV)}
        >
          Insert example
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="csv-area">CSV</Label>
        <Textarea
          id="csv-area"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          className="font-mono text-xs"
          placeholder="type,code,description,acquired_at,cost"
        />
      </div>
      {parseErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>CSV warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {parseErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {success ? <ImportSummary result={success} /> : null}
      <SheetFooter>
        <Button onClick={onSubmit} disabled={mutation.isPending}>
          {mutation.isPending ? "Importing…" : "Import"}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </SheetFooter>
    </div>
  );
}

function ImportSummary({ result }: { result: ImportSuccess }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge>{result.created.length} created</Badge>
        {result.skipped.length > 0 ? (
          <Badge variant="outline">{result.skipped.length} skipped</Badge>
        ) : null}
      </div>
      {result.skipped.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {result.skipped.map((r) => (
            <li key={`${r.rowIndex}-${r.reason}`}>
              Row {r.rowIndex + 1}: {skippedLabel(r)}
            </li>
          ))}
        </ul>
      ) : null}
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
    case "invalid":
      return "invalid";
    default:
      return "skipped";
  }
}

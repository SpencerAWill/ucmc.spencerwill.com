import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";

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
import { gearLabelsQueryOptions } from "#/features/gear/api/queries";
import {
  BARCODE_FORMAT_LABEL,
  BARCODE_FORMATS,
} from "#/features/gear/components/gear-barcode";
import type { BarcodeFormat } from "#/features/gear/components/gear-barcode";
import { GearLabelSheet } from "#/features/gear/components/gear-label-sheet";

/**
 * Print-labels dialog. Pass the publicIds of the gear to print and the
 * controlled open/onOpenChange handles. The dialog fetches the
 * label-ready rows lazily (`enabled: open && ids.length > 0`) so the
 * server fn doesn't fire until the dialog actually opens, and stays
 * cached afterward via TanStack Query so reopening with the same
 * selection is instant.
 *
 * The print stylesheet lives inside `GearLabelSheet` and uses a
 * `visibility: hidden` flip on `body *`, then re-shows
 * `.gear-labels-print-area` only. That trick works regardless of where
 * Radix Dialog portals the content — only the label grid prints.
 */
export function GearLabelsDialog({
  publicIds,
  open,
  onOpenChange,
}: {
  publicIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [format, setFormat] = useState<BarcodeFormat>("CODE128");
  const { data, isLoading, isError } = useQuery({
    ...gearLabelsQueryOptions(publicIds),
    enabled: open && publicIds.length > 0,
  });
  const labels = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(95vw,900px)] !max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Print labels</DialogTitle>
          <DialogDescription>
            Letter paper, 0.5″ margins. Each label is ~2″ × 1.1″ — compact for
            laminating and zip-tying to a piece of gear. Use your browser's
            print dialog (Cmd/Ctrl + P) to save as PDF or send to a printer.
          </DialogDescription>
        </DialogHeader>
        <div className="gear-labels-no-print flex items-end gap-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="barcode-format"
              className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
            >
              Barcode format
            </Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as BarcodeFormat)}
            >
              <SelectTrigger id="barcode-format" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BARCODE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {BARCODE_FORMAT_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading labels…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load labels.</p>
        ) : (
          <GearLabelSheet labels={labels} format={format} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => window.print()} disabled={labels.length === 0}>
            <Printer className="size-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

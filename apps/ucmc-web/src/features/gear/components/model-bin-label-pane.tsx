import { Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { DialogFooter } from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { DeskQuantityInput } from "#/features/gear/components/desk-quantity-input";
import { GearBarcode } from "#/features/gear/components/gear-barcode";
import { LabelPrintArea } from "#/features/gear/components/gear-label-sheet";
import { modelLabelPayload } from "#/features/gear/lib/model-label";

const MAX_COPIES = 12;

/**
 * Print bin labels for a counted model — the models dialog's "Bin
 * label" view.
 *
 * **Always CODE128**, with no format picker. The coded-label dialog
 * offers CODE39 and friends for short uppercase codes; this payload is
 * lowercase and carries a `:`, which CODE39 can't encode and ITF and
 * Codabar can't come near. CODE128 is also what every reader the desk
 * supports decodes, 1D lasers included — a QR would shut those out.
 *
 * **Wider than an item label.** `ucmc-model:` plus a 12-character id is
 * about 23 characters, roughly three times an item code, so at the
 * same bar width it needs ~3.5″ — a 2″ card would squeeze the bars
 * under what a phone camera resolves. A bin has the room a zip-tied
 * harness tag doesn't.
 *
 * **Copies, not bins.** A model split across two bins wants the same
 * label twice; nothing about the label differs per bin, so there is no
 * bin entity behind it (#223).
 */
export function ModelBinLabelPane({
  model,
  onDone,
}: {
  model: { publicId: string; name: string; typeName: string };
  onDone: () => void;
}) {
  const [copies, setCopies] = useState(1);
  const payload = modelLabelPayload(model.publicId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Stick this on the bin. Scanning it at the gear desk adds {model.name} to
        a checkout, or finds who has them out at check-in.
      </p>
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="bin-label-copies">Copies</Label>
          {/* The desk's quantity field, for its text draft: a plain
              controlled number input refuses the blank box between
              clearing "1" and typing "3". */}
          <DeskQuantityInput
            id="bin-label-copies"
            value={copies}
            onChange={setCopies}
            max={MAX_COPIES}
            label="Copies"
          />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          One per bin, if the stock is split.
        </p>
      </div>
      <div className="max-h-[45dvh] overflow-y-auto">
        <LabelPrintArea minLabelWidth="3.5in">
          {Array.from({ length: copies }, (_, i) => (
            <div
              key={i}
              className="gear-label-card space-y-1 rounded border bg-white p-2 text-black"
            >
              <p className="truncate text-sm font-semibold">{model.name}</p>
              <p className="text-xs">{model.typeName} · counted</p>
              <GearBarcode
                value={payload}
                format="CODE128"
                heightPx={48}
                barWidth={1.2}
                className="w-full"
              />
            </div>
          ))}
        </LabelPrintArea>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Back
        </Button>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print
        </Button>
      </DialogFooter>
    </div>
  );
}

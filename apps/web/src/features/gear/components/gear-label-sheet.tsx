import { useEffect } from "react";

import { GearBarcode } from "#/features/gear/components/gear-barcode";
import type { BarcodeFormat } from "#/features/gear/components/gear-barcode";
import type { GearLabel } from "#/features/gear/server/gear-fns";

/**
 * Print-ready grid of gear labels. Owns the print stylesheet so any
 * caller (a dialog, a dedicated route, a story) can just render this
 * and call `window.print()` to get a clean sheet — the @media print
 * rules hide everything in the document body except this component's
 * own `.gear-labels-print-area` subtree.
 *
 * The visibility-flip trick (rather than display:none) is what lets
 * the print area live inside a Radix portal and still appear correctly
 * on the printed page: portal placement doesn't matter once everything
 * outside our subtree is invisible.
 *
 * ⚠️ **Global print hammer.** The `body * { visibility: hidden }` rule
 * is intentionally site-wide while this component is mounted. Any
 * future feature that wants its own custom print output must EITHER
 * coexist with this rule (re-show its subtree with a similar
 * visibility-visible rule keyed on its own class) OR ensure its print
 * UI is never visible at the same time this dialog is open. Today only
 * one print surface exists; revisit if a second one shows up.
 */
export function GearLabelSheet({
  labels,
  format = "CODE128",
}: {
  labels: GearLabel[];
  format?: BarcodeFormat;
}) {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @media print {
        @page { size: letter; margin: 0.5in; }
        body { background: #ffffff; }
        body * { visibility: hidden !important; }
        .gear-labels-print-area,
        .gear-labels-print-area * { visibility: visible !important; }
        .gear-labels-print-area {
          position: absolute !important;
          left: 0;
          top: 0;
          width: 100%;
          padding: 0 !important;
          gap: 0.1in !important;
        }
        .gear-label-card {
          break-inside: avoid;
          border: 1px solid #000 !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  if (labels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No printable labels — all selected gear is either retired or has no
        code.
      </p>
    );
  }

  return (
    <div
      className="gear-labels-print-area grid gap-2"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2in, 1fr))" }}
    >
      {labels.map((label) => (
        <LabelCard key={label.publicId} label={label} format={format} />
      ))}
    </div>
  );
}

function LabelCard({
  label,
  format,
}: {
  label: GearLabel;
  format: BarcodeFormat;
}) {
  return (
    <div className="gear-label-card rounded border bg-white p-1 text-black">
      <GearBarcode
        value={label.code}
        format={format}
        heightPx={40}
        barWidth={1.2}
        displayValue
        className="w-full"
      />
    </div>
  );
}

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useRef, useState } from "react";

/** Supported barcode formats. Pruned to symbologies that actually make
 *  sense for the freeform alphanumeric codes UCMC uses (`CH93`, `LJ4`)
 *  AND that are readable by consumer phone-camera scanner apps. */
export const BARCODE_FORMATS = ["CODE128", "CODE39", "codabar", "ITF"] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** User-facing label for each supported format. */
export const BARCODE_FORMAT_LABEL: Record<BarcodeFormat, string> = {
  CODE128: "CODE 128 (recommended)",
  CODE39: "CODE 39 (uppercase only)",
  codabar: "Codabar (digits + few symbols)",
  ITF: "ITF (digits only, even count)",
};

/**
 * Renders a barcode for the given value as an inline SVG. SVG (not
 * canvas) so it stays crisp when printed and laminated.
 *
 * If JsBarcode rejects the value for the chosen format (e.g. CODE39
 * with lowercase, ITF with odd digit count), the component reports
 * `valid=false` back to the caller via `onValidity` so the UI can
 * surface a "code not encodable in this format" hint instead of a
 * confusing empty box.
 */
export function GearBarcode({
  value,
  format = "CODE128",
  heightPx = 60,
  /** Width per narrow bar, in CSS pixels. JsBarcode multiplies this
   *  to determine the overall barcode width; 1.5–2 is a good balance
   *  between density and scanner reliability on consumer phones. */
  barWidth = 1.6,
  /** Render the encoded value as text under the bars. Lets the caller
   *  use a single SVG as a complete label (bars + human-readable code)
   *  with no surrounding markup. */
  displayValue = false,
  className,
  onValidity,
}: {
  value: string;
  format?: BarcodeFormat;
  heightPx?: number;
  barWidth?: number;
  displayValue?: boolean;
  className?: string;
  onValidity?: (valid: boolean) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [renderedOk, setRenderedOk] = useState(true);
  // `useLayoutEffect` (not `useEffect`) so the SVG is populated before
  // the browser paints. A user mashing Cmd+P the moment the labels
  // dialog opens would otherwise see a blank print preview while
  // React's deferred effect was still pending.
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || value.length === 0) {
      setRenderedOk(false);
      onValidity?.(false);
      return;
    }
    try {
      JsBarcode(svg, value, {
        format,
        displayValue,
        margin: 0,
        height: heightPx,
        width: barWidth,
        background: "#ffffff",
        lineColor: "#000000",
        valid: (valid: boolean) => {
          setRenderedOk(valid);
          onValidity?.(valid);
        },
      });
    } catch {
      setRenderedOk(false);
      onValidity?.(false);
    }
  }, [value, format, heightPx, barWidth, displayValue, onValidity]);
  return (
    <svg
      ref={ref}
      className={className}
      aria-label={`Barcode ${value}`}
      data-valid={renderedOk}
    />
  );
}

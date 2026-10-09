import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { BarcodeScanner } from "#/features/gear/components/barcode-scanner";
import { useBarcodeWedge } from "#/features/gear/hooks/use-barcode-wedge";
import { cn } from "#/lib/utils";

/**
 * The gear desk's Scan column: the camera scanner, the USB
 * keyboard-wedge listener, and one shared confirmation for both.
 *
 * Both desk panes rendered this column verbatim before — the sticky
 * wrapper, the label, the scanner — and #223's counted pane will want
 * a third copy. One component also means the two input paths cannot
 * drift in what they tell the officer, which is the thing a second
 * hand-rolled copy gets wrong first.
 *
 * **The wedge defaults ON, the camera defaults OFF**, and the
 * asymmetry is the point: a camera that starts itself fires a
 * permission prompt the moment the Sheet opens, while a wedge that is
 * simply not plugged in costs nothing at all. Both choices persist per
 * officer in localStorage.
 */

const WEDGE_ENABLED_KEY = "ucmc:gear-scanner:wedge";

export function DeskScanControls({
  onScan,
}: {
  /** Fires for every scan, from either input path, with the raw payload. */
  onScan: (raw: string) => void;
}) {
  const [wedgeEnabled, setWedgeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    // Absent means never toggled, which defaults on. Only an explicit
    // "false" turns it off.
    return window.localStorage.getItem(WEDGE_ENABLED_KEY) !== "false";
  });
  const [lastScan, setLastScan] = useState<{
    raw: string;
    source: "camera" | "wedge";
    /** Bumped per scan so two identical codes still re-announce. */
    seq: number;
  } | null>(null);
  // Sticks once a wedge burst has been seen. The browser cannot
  // enumerate HID devices, so "a scan arrived in wedge shape" is the
  // only honest evidence a gun is plugged in that we will ever have.
  const [wedgeSeen, setWedgeSeen] = useState(false);

  const announce = useCallback((raw: string, source: "camera" | "wedge") => {
    setLastScan((prev) => ({ raw, source, seq: (prev?.seq ?? 0) + 1 }));
    if (source === "wedge") setWedgeSeen(true);
  }, []);

  const handleCameraResult = useCallback(
    (raw: string) => {
      announce(raw, "camera");
      onScan(raw);
    },
    [announce, onScan],
  );

  const handleWedgeScan = useCallback(
    (raw: string) => {
      announce(raw, "wedge");
      onScan(raw);
    },
    [announce, onScan],
  );

  useBarcodeWedge({ onScan: handleWedgeScan, enabled: wedgeEnabled });

  // Clear the confirmation ~2 s after each scan so it doesn't hang
  // around once the officer has moved to the next piece. Keyed on
  // `seq` rather than the payload, or a repeat scan of one code would
  // not restart the timer.
  const seq = lastScan?.seq;
  useEffect(() => {
    if (seq === undefined) return;
    const id = window.setTimeout(() => setLastScan(null), 2000);
    return () => {
      window.clearTimeout(id);
    };
  }, [seq]);

  const onWedgeToggle = (next: boolean) => {
    setWedgeEnabled(next);
    window.localStorage.setItem(WEDGE_ENABLED_KEY, String(next));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Scan
      </Label>
      <BarcodeScanner onResult={handleCameraResult} />

      <div className="flex items-center gap-2 pt-1">
        <Switch
          id="wedge-toggle"
          checked={wedgeEnabled}
          onCheckedChange={onWedgeToggle}
        />
        <Label
          htmlFor="wedge-toggle"
          className="flex items-center gap-1.5 text-sm"
        >
          <Keyboard className="size-3.5 opacity-70" aria-hidden />
          USB scanner
        </Label>
        {wedgeEnabled ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                wedgeSeen ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            {wedgeSeen ? "Connected" : "Ready"}
          </span>
        ) : null}
      </div>

      {/* One confirmation for both input paths. `aria-live` rather than
          a toast: a scan is a high-frequency, low-stakes event, and a
          toast per piece would bury the ones that actually report a
          refusal. */}
      <p
        className="min-h-5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        aria-live="polite"
      >
        {lastScan ? (
          <>
            Scanned <span className="font-mono">{lastScan.raw}</span>
            <span className="text-muted-foreground">
              {lastScan.source === "wedge" ? " (USB)" : " (camera)"}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

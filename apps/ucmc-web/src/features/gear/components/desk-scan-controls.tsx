import { Camera, ScanBarcode, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Label } from "#/components/ui/label";
import { Toggle } from "#/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { BarcodeScanner } from "#/features/gear/components/barcode-scanner";
import { VIEWFINDER_CONTROL_CLASS } from "#/features/gear/components/viewfinder-control";
import { useBarcodeWedge } from "#/features/gear/hooks/use-barcode-wedge";
import { useScanBeep } from "#/features/gear/hooks/use-scan-beep";
import { parseScanPayload } from "#/features/gear/lib/scan-payload";
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
 *
 * **Both inputs are icon toggles floated over the viewfinder's corners**
 * (camera and its scan sound stacked top-left, handheld top-right),
 * each with a tooltip, named for what the officer holds: "Camera" and
 * "Handheld scanner". They were labelled switches in a row of their
 * own, "Scanner" and "USB scanner" — but both are scanners, and the
 * handheld path isn't USB specifically: a Bluetooth gun in keyboard
 * mode arrives the same way. The handheld's ready / connected state is
 * a badge on its icon, spelled out in the tooltip and in an
 * `aria-describedby` for screen readers, since a tooltip never opens
 * on touch. The camera's toggle lives here rather than inside
 * `BarcodeScanner`; the viewfinder is controlled.
 */

const WEDGE_ENABLED_KEY = "ucmc:gear-scanner:wedge";
// The key predates the rename and is kept, so an officer's saved
// choice survives it.
const CAMERA_ENABLED_KEY = "ucmc:gear-scanner:enabled";
const SOUND_ENABLED_KEY = "ucmc:gear-scanner:sound";

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
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CAMERA_ENABLED_KEY) === "true";
  });
  const onCameraToggle = useCallback((next: boolean) => {
    setCameraEnabled(next);
    window.localStorage.setItem(CAMERA_ENABLED_KEY, String(next));
  }, []);
  // Off by default — a desk that starts beeping unasked in a quiet
  // room is worse than one the officer has to switch on once.
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SOUND_ENABLED_KEY) === "true";
  });
  const { beep, prime } = useScanBeep(soundEnabled);
  const onSoundToggle = (next: boolean) => {
    // The click IS the gesture that lets the audio context start.
    if (next) prime();
    setSoundEnabled(next);
    window.localStorage.setItem(SOUND_ENABLED_KEY, String(next));
  };
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
    // A burst proves a gun is plugged in whatever it decoded, so the
    // indicator flips on anything.
    if (source === "wedge") setWedgeSeen(true);
    // The green line does NOT. It used to render for every payload,
    // which put "Scanned https://…" beside the "that didn't look like
    // a gear label" toast the same action raised — two contradictory
    // answers to one trigger pull, on what is now the default-on input.
    // Resolved through the same discriminator the panes use rather than
    // a second opinion about what counts as a code.
    if (parseScanPayload(raw) === null) {
      setLastScan(null);
      return;
    }
    setLastScan((prev) => ({ raw, source, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleCameraResult = useCallback(
    (raw: string) => {
      announce(raw, "camera");
      // Camera only: a handheld gun beeps on its own, and two tones for
      // one trigger pull is noise. Only for a payload that parses — the
      // same rule as the green confirmation line.
      if (parseScanPayload(raw) !== null) beep();
      onScan(raw);
    },
    [announce, beep, onScan],
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

  const handheldStatus = !wedgeEnabled
    ? "Handheld scanner off"
    : wedgeSeen
      ? "Handheld scanner connected"
      : "Handheld scanner ready — a scan confirms it's plugged in";

  const onWedgeToggle = (next: boolean) => {
    setWedgeEnabled(next);
    window.localStorage.setItem(WEDGE_ENABLED_KEY, String(next));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Scan
      </Label>
      <BarcodeScanner
        onResult={handleCameraResult}
        enabled={cameraEnabled}
        onEnabledChange={onCameraToggle}
        overlayLeft={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={cameraEnabled}
                  onPressedChange={onCameraToggle}
                  aria-label="Camera"
                  className={VIEWFINDER_CONTROL_CLASS}
                >
                  <Camera />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                {cameraEnabled ? "Camera on — click to stop" : "Camera off"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={soundEnabled}
                  onPressedChange={onSoundToggle}
                  aria-label="Scan sound"
                  className={VIEWFINDER_CONTROL_CLASS}
                >
                  {soundEnabled ? <Volume2 /> : <VolumeX />}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                {soundEnabled
                  ? "Scan sound on — beeps on each camera scan"
                  : "Scan sound off"}
              </TooltipContent>
            </Tooltip>
          </>
        }
        overlayRight={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={wedgeEnabled}
                  onPressedChange={onWedgeToggle}
                  aria-label="Handheld scanner"
                  aria-describedby="handheld-status"
                  className={cn(VIEWFINDER_CONTROL_CLASS, "relative")}
                >
                  <ScanBarcode />
                  {/* The ready / connected badge. Grey until a burst
                      arrives — the browser can't enumerate HID devices,
                      so a scan is the only evidence a gun is plugged in
                      that we will ever have — then green. */}
                  {wedgeEnabled ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-black/60",
                        wedgeSeen ? "bg-emerald-500" : "bg-neutral-400",
                      )}
                    />
                  ) : null}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>{handheldStatus}</TooltipContent>
            </Tooltip>
            <span id="handheld-status" className="sr-only">
              {handheldStatus}
            </span>
          </>
        }
      />

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
              {lastScan.source === "wedge" ? " (handheld)" : " (camera)"}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

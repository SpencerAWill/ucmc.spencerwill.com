import { Loader2, Search } from "lucide-react";
import { Suspense, lazy, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";

/**
 * Lazy-load the underlying `<Scanner>` component so the ~120 KB
 * barcode-detector polyfill + library only land on routes that
 * actually open the scanner (today: `/gear/loans`). Modern Safari
 * iOS 17+ and Android Chrome use the native BarcodeDetector API
 * exposed by the polyfill — there's no JS decode loop on those
 * browsers, which is a battery win at the gear cave.
 */
const Scanner = lazy(() =>
  import("@yudiel/react-qr-scanner").then((m) => ({ default: m.Scanner })),
);

/**
 * Camera-based barcode lookup dialog. The library exposes 19 formats
 * via `barcode-detector`; we whitelist the symbologies we actually
 * print (CODE128 today, QR future-proofed) so the detector doesn't
 * waste cycles trying every option.
 *
 * Permission handling lives at the dialog level — first open prompts
 * the user via the underlying `getUserMedia`; subsequent opens reuse
 * the permission. We don't cache anything ourselves.
 *
 * `paused={!open}` tears down the camera stream cleanly when the
 * dialog closes, which keeps the OS camera indicator off and battery
 * cost zero until the next open.
 */
export function BarcodeScanner({
  open,
  onOpenChange,
  onResult,
  onSearchInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires ONCE per successful decode with the raw barcode string.
   *  The component closes itself after firing; the caller is
   *  responsible for resolving the code via `fetchGearByCode` and
   *  routing the result into local state. */
  onResult: (code: string) => void;
  /** Optional escape hatch — when present, renders a "Search instead"
   *  button that closes the scanner and lets the parent open the
   *  manual code-search combobox. Useful when the camera fails or
   *  the user prefers typing. */
  onSearchInstead?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleScan = (detected: { rawValue: string }[]) => {
    const code = detected[0]?.rawValue?.trim();
    if (!code) return;
    onResult(code);
    onOpenChange(false);
  };

  const handleError = (err: unknown) => {
    if (err instanceof Error) {
      // Common cases worth surfacing distinctly:
      //   - NotAllowedError → user denied camera permission
      //   - NotFoundError → no camera attached
      //   - NotReadableError → camera held by another app
      // Default copy works for all of these; the user just needs to
      // know they can fall back to search.
      setError(err.message || "Couldn't start the camera.");
    } else {
      setError("Couldn't start the camera.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan barcode</DialogTitle>
          <DialogDescription>
            Hold a gear label in the rear camera's view. The code reads
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="aspect-square overflow-hidden rounded-md border bg-black">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
              <p>{error}</p>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-white">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              }
            >
              <Scanner
                constraints={{ facingMode: "environment" }}
                formats={["code_128", "qr_code"]}
                paused={!open}
                scanDelay={300}
                onScan={handleScan}
                onError={handleError}
              />
            </Suspense>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {onSearchInstead ? (
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
                onSearchInstead();
              }}
            >
              <Search className="size-4" />
              Search code instead
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

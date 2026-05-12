import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

/**
 * Camera-based barcode lookup dialog. Hybrid runtime:
 *
 *   1. If the browser ships `BarcodeDetector` natively (Chrome / Edge /
 *      Android Chrome / Safari iOS 17+ / Safari macOS 17+), use it
 *      directly — zero deps, zero WASM, fastest path.
 *   2. Otherwise (Firefox, pre-17 Safari) lazy-load the
 *      `barcode-detector` ponyfill and point its WASM source at the
 *      locally-vendored copy in `public/zxing-wasm/`. The CDN default
 *      would be blocked by our CSP's `connect-src 'self'`; the local
 *      copy keeps everything same-origin.
 *
 * SSR safety: every `navigator` / `window` / `BarcodeDetector` read
 * lives inside `useEffect`, so the component renders cleanly during
 * SSR. The polyfill import is a dynamic `import()` so its module
 * doesn't even resolve unless the native API is unavailable AND the
 * dialog is opened.
 *
 * CSP: `Permissions-Policy: camera=(self)` is required. The polyfill
 * path additionally needs `script-src 'wasm-unsafe-eval'`. The native
 * path needs neither beyond `camera=(self)`. See
 * `apps/web/src/server/headers.server.ts`.
 *
 * Camera picker: laptops at the gear cave commonly attach a USB camera
 * for scanning while the built-in webcam stays for video calls. The
 * dialog enumerates video inputs and lets the officer pick; the choice
 * persists across sessions via localStorage.
 */

/** Format whitelist matches what our label printer emits (CODE128) plus
 *  QR for future-proofing. Narrowing the scope tells both the native
 *  and polyfill paths to skip every other symbology each frame. */
const BARCODE_FORMATS = ["code_128", "qr_code"] as const;

const SELECTED_CAMERA_KEY = "ucmc:gear-scanner:camera";

// Minimal typings for the BarcodeDetector contract — same shape across
// the native API and the ponyfill, so one set of types covers both.
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorInstance {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
}

/**
 * Resolve a `BarcodeDetector` constructor — native if available,
 * polyfill otherwise. The polyfill is dynamic-imported so its WASM
 * payload (~1 MB) only ships to browsers that need it.
 */
async function loadBarcodeDetector(): Promise<BarcodeDetectorCtor> {
  const win = window as { BarcodeDetector?: BarcodeDetectorCtor };
  if (win.BarcodeDetector) return win.BarcodeDetector;
  const mod = await import("barcode-detector/ponyfill");
  mod.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => {
        // Redirect WASM fetches to our locally-vendored copy. Same
        // origin → `connect-src 'self'` is enough.
        if (path.endsWith(".wasm")) return `/zxing-wasm/${path}`;
        return prefix + path;
      },
    },
  });
  return mod.BarcodeDetector as unknown as BarcodeDetectorCtor;
}

export function BarcodeScanner({
  open,
  onOpenChange,
  onResult,
  onSearchInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires ONCE per successful decode with the raw barcode string. The
   *  component closes itself after firing; the caller resolves the
   *  code via `fetchGearByCode` and routes the result into local
   *  state. */
  onResult: (code: string) => void;
  /** Optional escape hatch — renders a "Search instead" button that
   *  closes the scanner and lets the parent open the manual
   *  code-search combobox. */
  onSearchInstead?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // Remember the last-picked camera across sessions so a gear-cave
  // officer doesn't have to switch USB → built-in every time.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem(SELECTED_CAMERA_KEY);
    },
  );

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);

    /* eslint-disable @typescript-eslint/no-unnecessary-condition --
     *  `flags.cancelled` and `flags.detected` legitimately flip across
     *  async ticks (one written from the cleanup return, the other
     *  written from a deferred animation-frame callback). ESLint can't
     *  see those mutations from the read sites and concludes they're
     *  always their initial value — they're not. */

    // Closure-scoped flags across async ticks. Explicit `boolean`
    // typing prevents ESLint's no-unnecessary-condition from narrowing
    // them to their literal-`false` initial values — both fields can
    // flip between resolved promise points.
    const flags: { cancelled: boolean; detected: boolean } = {
      cancelled: false,
      detected: false,
    };

    void (async () => {
      try {
        // Constraints: prefer the persisted deviceId; otherwise prefer
        // the rear-facing camera on phones. On a laptop without
        // `environment`, the browser picks any available camera.
        const constraints: MediaStreamConstraints = {
          video: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : { facingMode: "environment" },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (flags.cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        // Enumerate AFTER getting a stream — device labels are only
        // exposed once camera permission has been granted at least
        // once for this origin.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!flags.cancelled) {
          setDevices(all.filter((d) => d.kind === "videoinput"));
        }

        const Ctor = await loadBarcodeDetector();
        if (flags.cancelled) return;
        const detector = new Ctor({ formats: [...BARCODE_FORMATS] });

        const scan = async () => {
          if (flags.cancelled || flags.detected) return;
          // `readyState >= 2` means HAVE_CURRENT_DATA — frame data is
          // available to draw / decode. Earlier states make detect()
          // either fail or return empty.
          if (video.readyState >= 2) {
            try {
              const results = await detector.detect(video);
              const first = results[0]?.rawValue;
              if (first && !flags.detected) {
                flags.detected = true;
                onResult(first);
                onOpenChange(false);
                return;
              }
            } catch {
              // Per-frame detect failures are transient (browser may
              // throw on a not-ready video frame). Ignore and retry.
            }
          }
          rafRef.current = requestAnimationFrame(() => {
            void scan();
          });
        };
        rafRef.current = requestAnimationFrame(() => {
          void scan();
        });
      } catch (err) {
        if (flags.cancelled) return;
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("Camera permission denied.");
        } else if (err instanceof Error && err.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else if (
          err instanceof Error &&
          err.name === "OverconstrainedError"
        ) {
          // The persisted deviceId no longer matches any attached
          // camera (USB unplugged, etc.). Clear it and ask the user
          // to reopen — simpler than auto-retrying with defaults.
          setSelectedDeviceId(null);
          window.localStorage.removeItem(SELECTED_CAMERA_KEY);
          setError(
            "Selected camera isn't available. Reopen to pick a different one.",
          );
        } else {
          setError("Couldn't start the camera.");
        }
      }
    })();

    return () => {
      flags.cancelled = true;
      stopStream();
    };
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  }, [open, onOpenChange, onResult, selectedDeviceId, stopStream]);

  // When the user picks a different camera, persist + restart by
  // updating state (the effect above re-runs on selectedDeviceId).
  const onDeviceChange = (id: string) => {
    setSelectedDeviceId(id);
    window.localStorage.setItem(SELECTED_CAMERA_KEY, id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan barcode</DialogTitle>
          <DialogDescription>
            Hold a gear label in the camera's view. The code reads
            automatically.
          </DialogDescription>
        </DialogHeader>
        {devices.length > 1 ? (
          <div className="space-y-1.5">
            <Label
              htmlFor="scanner-camera"
              className="text-xs text-muted-foreground"
            >
              Camera
            </Label>
            <Select
              value={selectedDeviceId ?? devices[0].deviceId}
              onValueChange={onDeviceChange}
            >
              <SelectTrigger id="scanner-camera" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d, i) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="aspect-square overflow-hidden rounded-md border bg-black">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
              <p>{error}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
                aria-label="Camera viewfinder"
              />
              {streamRef.current === null ? (
                <div className="-mt-[100%] flex h-full items-center justify-center text-white">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              ) : null}
            </>
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

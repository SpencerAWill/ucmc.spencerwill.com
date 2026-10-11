import { Camera, Loader2, SwitchCamera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { VIEWFINDER_CONTROL_CLASS } from "#/features/gear/components/viewfinder-control";
import { cn } from "#/lib/utils";

/**
 * Inline camera-based barcode scanner. Designed to live directly in
 * the gear-desk Sheet rather than behind another modal — officers
 * rip through a batch with viewfinder and items-list visible at the
 * same time. Hybrid runtime:
 *
 *   1. If the browser ships `BarcodeDetector` natively (Chrome, Edge
 *      and Android Chrome), use it directly — zero deps, zero WASM,
 *      fastest path. The feature test below is the authority; this
 *      list is just orientation.
 *   2. Otherwise (Firefox and Safari, which have not shipped the
 *      Barcode Detection API) lazy-load the `barcode-detector`
 *      ponyfill and point its WASM source at the same-origin copy in
 *      `public/zxing-wasm/`. The CDN default would be blocked by our
 *      CSP's `connect-src 'self'`. That copy is written at build time
 *      by `scripts/sync-zxing-wasm.ts` from the installed `zxing-wasm`
 *      — it MUST match the glue JS exactly. A hand-vendored binary
 *      from an older release instantiates cleanly (same import/export
 *      surface) and then throws on every decode, which the loop below
 *      now surfaces rather than swallowing.
 *
 * SSR safety: every `navigator` / `window` / `BarcodeDetector` read
 * lives inside `useEffect`, so the component renders cleanly during
 * SSR. The polyfill import is a dynamic `import()` so its module
 * doesn't even resolve unless the native API is unavailable AND the
 * scanner is toggled on.
 *
 * CSP: `Permissions-Policy: camera=(self)` is required. The polyfill
 * path additionally needs `script-src 'wasm-unsafe-eval'`. The native
 * path needs neither beyond `camera=(self)`. See
 * `apps/ucmc-web/src/server/headers.server.ts`.
 *
 * Enabled state persists in localStorage. New officers default to
 * scanner OFF so the camera permission prompt doesn't fire as soon as
 * they open the Sheet; once they've toggled it on and granted
 * permission, the scanner auto-starts on subsequent Sheet opens.
 *
 * Scan feedback is NOT rendered here. `DeskScanControls` owns one
 * status line for the camera and the USB wedge together — two
 * confirmations for the same officer action would drift in wording and
 * in timing, and the wedge has no viewfinder to overlay one on anyway.
 *
 * Camera picker: laptops at the gear cave commonly attach a USB
 * camera for scanning while the built-in webcam stays for video
 * calls. After permission is granted (which exposes labels) a
 * "Switch camera" icon appears in the viewfinder's top-left stack and
 * opens a menu of cameras — only while the camera is on and there's
 * more than one. The choice persists across sessions via localStorage.
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
        // Redirect WASM fetches to the build-time copy written by
        // `scripts/sync-zxing-wasm.ts`. Same origin → `connect-src
        // 'self'` is enough.
        if (path.endsWith(".wasm")) return `/zxing-wasm/${path}`;
        return prefix + path;
      },
    },
  });
  return mod.BarcodeDetector as unknown as BarcodeDetectorCtor;
}

export function BarcodeScanner({
  onResult,
  enabled,
  onEnabledChange,
  overlayLeft,
  overlayRight,
}: {
  /** Fires for EACH detected scan while the scanner is enabled. The
   *  scanner stays live until the officer toggles it off or closes
   *  the Sheet. A label held in view fires ONCE; the same code fires
   *  again only after it has been out of view for 1.5 s. */
  onResult: (code: string) => void;
  /** Controlled by the parent, whose switch row sits beside the
   *  handheld scanner's — two inputs, one row. The viewfinder's own
   *  "tap to start" and a denied permission both report back through
   *  `onEnabledChange`. */
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  /** Controls floated over the viewfinder's top corners. Rendered as
   *  siblings of the "tap to start" button, never inside it, so a click
   *  on one doesn't also start the camera. */
  overlayLeft?: ReactNode;
  overlayRight?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
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
    setStreamReady(false);
  }, []);

  // Capture `onResult` in a ref so the camera-startup effect doesn't
  // restart every time the parent's handler changes identity. Parents
  // typically declare `handleScan` inline (reading from local state
  // like `defaultDurationDays`), so the function reference shifts on
  // each render — without this ref, every items-list mutation tore
  // down the stream and re-acquired the camera.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  // Same reasoning: the camera effect reports a denied permission
  // through this, and must not restart when its identity changes.
  const onEnabledChangeRef = useRef(onEnabledChange);
  useEffect(() => {
    onEnabledChangeRef.current = onEnabledChange;
  }, [onEnabledChange]);

  useEffect(() => {
    if (!enabled) {
      stopStream();
      setError(null);
      return;
    }
    setError(null);

    // `flags.cancelled` is mutated by the effect's cleanup return; the
    // async closure below reads it across `await` boundaries. A couple
    // of post-narrowing read sites are silenced with line-level
    // disables — see those comments for context.
    const flags: { cancelled: boolean } = { cancelled: false };

    void (async () => {
      try {
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
        setStreamReady(true);

        // Enumerate AFTER getting a stream — labels are only exposed
        // once camera permission has been granted at least once for
        // this origin.
        const all = await navigator.mediaDevices.enumerateDevices();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- flags.cancelled flips in cleanup across async ticks; TS narrows it to false based on the earlier early-exit checks.
        if (!flags.cancelled) {
          setDevices(all.filter((d) => d.kind === "videoinput"));
        }

        const Ctor = await loadBarcodeDetector();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above; cleanup flip is invisible to the narrower.
        if (flags.cancelled) return;
        const detector = new Ctor({ formats: [...BARCODE_FORMATS] });

        // Persistent-scan loop. The detector reports a label on every
        // frame it's in view — dozens of times a second — and one label
        // held in front of the camera is one scan, however long it stays
        // there. So a code fires once, then not again until it has been
        // OUT of view for `SAME_CODE_GAP_MS`.
        //
        // The window slides: `seenAt` is refreshed on every sighting,
        // not only when the code fires. It used to be measured from the
        // last fire, so a label held still re-fired every 1.5 s — a
        // fresh "can't be checked out" toast each time, and for a cart
        // QR a fresh cart resolve and `loan.cart_scanned` audit row.
        // Taking the label away and showing it again is still a rescan.
        const SAME_CODE_GAP_MS = 1500;
        const lastSeen: { code: string | null; seenAt: number } = {
          code: null,
          seenAt: 0,
        };

        // A `detect()` throw is usually transient — the browser rejects
        // on a frame that isn't ready yet — so one failure means nothing
        // and retrying is right. A detector that throws on EVERY frame is
        // a different animal: it's broken, and the old code's blanket
        // swallow made that indistinguishable from "no barcode in view".
        // A stale vendored WASM did exactly that for the whole ponyfill
        // path and nobody noticed, because the preview kept running and
        // the scanner looked healthy. Count consecutive failures and
        // surface the dead detector instead of spinning forever.
        const DETECT_FAILURE_LIMIT = 30;
        const failures = { consecutive: 0 };

        const scan = async () => {
          if (flags.cancelled) return;
          if (video.readyState >= 2) {
            try {
              const results = await detector.detect(video);
              failures.consecutive = 0;
              const first = results[0]?.rawValue;
              if (first) {
                const now = performance.now();
                const stillInView =
                  lastSeen.code === first &&
                  now - lastSeen.seenAt < SAME_CODE_GAP_MS;
                lastSeen.code = first;
                lastSeen.seenAt = now;
                if (!stillInView) {
                  // Read through the ref so this closure uses the
                  // latest parent handler without forcing the effect
                  // (and therefore the camera stream) to restart.
                  onResultRef.current(first);
                }
              }
            } catch {
              failures.consecutive += 1;
              if (failures.consecutive >= DETECT_FAILURE_LIMIT) {
                setError(
                  "Scanner can't read the camera feed. Reload the page; if it keeps happening the barcode reader needs attention.",
                );
                return;
              }
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
          // If permission was denied, flip the toggle off so the next
          // open doesn't auto-retry and re-trigger the same error.
          onEnabledChangeRef.current(false);
        } else if (err instanceof Error && err.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else if (
          err instanceof Error &&
          err.name === "OverconstrainedError"
        ) {
          if (selectedDeviceId !== null) {
            // Saved camera (e.g. an unplugged USB scanner) is no longer
            // available. Clear the pin and let the effect re-run with
            // the default `facingMode: "environment"` constraints —
            // intentionally don't set an error so the user doesn't see
            // a flash of failure before the retry lands.
            setSelectedDeviceId(null);
            window.localStorage.removeItem(SELECTED_CAMERA_KEY);
          } else {
            // Already on defaults and still overconstrained — nothing
            // more to fall back to.
            setError("No usable camera on this device.");
          }
        } else {
          setError("Couldn't start the camera.");
        }
      }
    })();

    return () => {
      flags.cancelled = true;
      stopStream();
    };
    // `onResult` is intentionally NOT a dep — it lives in
    // `onResultRef`. Including it would tear down the camera every
    // time the parent re-renders.
  }, [enabled, selectedDeviceId, stopStream]);

  const onDeviceChange = (id: string) => {
    setSelectedDeviceId(id);
    window.localStorage.setItem(SELECTED_CAMERA_KEY, id);
  };

  return (
    <div className="space-y-2">
      <div className="relative h-40 w-full overflow-hidden rounded-md border bg-black md:aspect-square md:h-auto">
        {/* Mobile uses a fixed 160 px height — full width but compact
            so it doesn't dominate the Sheet when the items list grows
            beneath. On md+ it returns to a square (cell is fixed at
            18 rem; aspect-square gives a 18 rem tall preview). */}
        {!enabled ? (
          <button
            type="button"
            onClick={() => onEnabledChange(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80 transition-colors hover:bg-neutral-900"
          >
            <Camera className="size-8 opacity-60" />
            <p>Tap to start the camera</p>
            <p className="text-xs text-white/50">
              Hold a gear label in view to capture
            </p>
          </button>
        ) : error ? (
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
            {!streamReady ? (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : (
              <AimingFrame />
            )}
          </>
        )}
        {overlayLeft || (enabled && devices.length > 1) ? (
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1.5">
            {overlayLeft}
            {/* Last in the stack, so the controls above don't shift when
                it appears. Only when there's a choice to make: one
                camera, or the camera off, and it's absent. */}
            {enabled && devices.length > 1 ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger
                      aria-label="Switch camera"
                      className={cn(VIEWFINDER_CONTROL_CLASS)}
                    >
                      <SwitchCamera />
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Switch camera</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Camera</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={selectedDeviceId ?? devices[0].deviceId}
                    onValueChange={onDeviceChange}
                  >
                    {devices.map((d, i) => (
                      <DropdownMenuRadioItem
                        key={d.deviceId}
                        value={d.deviceId}
                      >
                        {d.label || `Camera ${i + 1}`}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
        {overlayRight ? (
          <div className="absolute top-2 right-2 z-10 flex gap-1.5">
            {overlayRight}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Where to hold the label. Wide and short because our labels are
 * CODE128 strips, corners only so it frames rather than hides the
 * preview, and `pointer-events-none` so it never eats a tap. The
 * detector reads the whole frame regardless — this is guidance for a
 * first-time officer, not a crop.
 */
function AimingFrame() {
  const corner = "absolute size-4 border-white/80";
  return (
    <div
      aria-hidden
      // The drop-shadow keeps white corners visible over a white label —
      // the preview behind them is whatever the camera sees.
      className="pointer-events-none absolute inset-x-[15%] top-1/2 h-[38%] -translate-y-1/2 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
    >
      <span
        className={cn(
          corner,
          "top-0 left-0 rounded-tl-md border-t-2 border-l-2",
        )}
      />
      <span
        className={cn(
          corner,
          "top-0 right-0 rounded-tr-md border-t-2 border-r-2",
        )}
      />
      <span
        className={cn(
          corner,
          "bottom-0 left-0 rounded-bl-md border-b-2 border-l-2",
        )}
      />
      <span
        className={cn(
          corner,
          "right-0 bottom-0 rounded-br-md border-r-2 border-b-2",
        )}
      />
    </div>
  );
}

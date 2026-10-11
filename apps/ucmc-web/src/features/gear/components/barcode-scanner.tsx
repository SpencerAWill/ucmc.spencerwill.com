import { Camera, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";

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
 * calls. After permission is granted (which exposes labels) the
 * `Select` lets the officer pick. The choice persists across sessions
 * via localStorage.
 */

/** Format whitelist matches what our label printer emits (CODE128) plus
 *  QR for future-proofing. Narrowing the scope tells both the native
 *  and polyfill paths to skip every other symbology each frame. */
const BARCODE_FORMATS = ["code_128", "qr_code"] as const;

const SELECTED_CAMERA_KEY = "ucmc:gear-scanner:camera";
const SCANNER_ENABLED_KEY = "ucmc:gear-scanner:enabled";

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
}: {
  /** Fires for EACH detected scan while the scanner is enabled. The
   *  scanner stays live until the officer toggles it off or closes
   *  the Sheet. A label held in view fires ONCE; the same code fires
   *  again only after it has been out of view for 1.5 s. */
  onResult: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Enabled flag: persisted in localStorage so a returning officer
  // auto-starts where they left off. SSR-safe initial-state callback.
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SCANNER_ENABLED_KEY) === "true";
  });
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
          setEnabled(false);
          window.localStorage.setItem(SCANNER_ENABLED_KEY, "false");
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

  const onToggle = (next: boolean) => {
    setEnabled(next);
    window.localStorage.setItem(SCANNER_ENABLED_KEY, String(next));
  };

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
            onClick={() => onToggle(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80 transition-colors hover:bg-neutral-900"
          >
            <Camera className="size-8 opacity-60" />
            <p>Tap to start the scanner</p>
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
            ) : null}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="scanner-toggle"
            checked={enabled}
            onCheckedChange={onToggle}
          />
          <Label htmlFor="scanner-toggle" className="text-sm">
            Scanner
          </Label>
        </div>
        {enabled && devices.length > 1 ? (
          <Select
            value={selectedDeviceId ?? devices[0].deviceId}
            onValueChange={onDeviceChange}
          >
            <SelectTrigger className="ml-auto h-8 w-auto gap-1.5 px-2 text-xs">
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
        ) : null}
      </div>
    </div>
  );
}

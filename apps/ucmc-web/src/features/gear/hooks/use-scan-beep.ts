import { useCallback, useEffect, useRef } from "react";

/**
 * A short confirmation tone for the desk's camera scanner.
 *
 * Synthesised with the Web Audio API rather than shipped as a sound file:
 * no asset to cache-bust, nothing for the CSP to allow, and the scanning
 * library (`barcode-detector`) has no audio of its own — it decodes and
 * nothing else.
 *
 * **The context is created lazily and only from a user gesture.**
 * Browsers' autoplay policies start an `AudioContext` suspended unless
 * the page has been interacted with; `prime` is called from the click
 * that turns sound on, and `beep` resumes it defensively since a camera
 * scan is not itself a gesture.
 *
 * Not in `api/`: there's no query client here, only a browser API.
 */
export function useScanBeep(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  const ensureContext = useCallback((): AudioContext | null => {
    if (contextRef.current) {
      return contextRef.current;
    }
    if (typeof window === "undefined" || !("AudioContext" in window)) {
      return null;
    }
    contextRef.current = new AudioContext();
    return contextRef.current;
  }, []);

  /** Create and unlock the context. Call from a click handler. */
  const prime = useCallback(() => {
    void ensureContext()?.resume();
  }, [ensureContext]);

  const beep = useCallback(() => {
    if (!enabled) {
      return;
    }
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // A high, short blip — the register of a checkout scanner, and short
    // enough that a batch of scans doesn't run together.
    osc.type = "sine";
    osc.frequency.setValueAtTime(1760, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }, [enabled, ensureContext]);

  // Release the audio device when the desk closes.
  useEffect(
    () => () => {
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  return { beep, prime };
}

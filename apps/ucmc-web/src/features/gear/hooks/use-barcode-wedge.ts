import { useCallback, useEffect, useRef } from "react";

import {
  IDLE_WEDGE_STATE,
  feedKey,
  isWedgeOpener,
} from "#/features/gear/lib/wedge-buffer";
import type { WedgeState } from "#/features/gear/lib/wedge-buffer";

/**
 * Listens for USB keyboard-wedge barcode scans while mounted, and hands
 * each completed payload to `onScan` (#215).
 *
 * The policy lives in `lib/wedge-buffer.ts`; this is the plumbing — the
 * listener, the focus rules, and the decision about which keystrokes
 * are evidence at all.
 *
 * ## Why no auto-focus, and no hidden input
 *
 * The listener is on `document` in the **capture phase**, so focus is
 * irrelevant: the burst is seen wherever the caret happens to be, and
 * before `cmdk`'s `CommandInput` or Radix's focus manager get a look.
 * The alternative #215 weighed — a permanently-focused hidden input —
 * has to fight the Sheet for focus and steals it from the member
 * combobox and the notes field. Not competing at all is strictly
 * better than winning.
 *
 * ## Marking a field as a scan target
 *
 * Any element carrying `data-wedge-capture` opts out of the text-field
 * protection below, so a tier-2 burst typed into it is routed to
 * `onScan` instead of being left to the field. The gear-code combobox
 * wears it, and the reason is specific: that input is *already* an
 * accidental wedge target — its own doc comment describes typing a code
 * and pressing Enter — but it resolves by prefix search and first
 * match, while `onScan` resolves exactly. Without the attribute one
 * trigger pull would mean two different things depending on where
 * focus sat, which is the kind of defect nobody can reproduce on
 * demand.
 */
export function useBarcodeWedge({
  onScan,
  enabled,
}: {
  /** Fires once per completed burst, with the raw payload. */
  onScan: (raw: string) => void;
  enabled: boolean;
}) {
  const stateRef = useRef<WedgeState>(IDLE_WEDGE_STATE);

  // Read the handler through a ref. Both desk panes declare `handleScan`
  // inline over local state, so its identity shifts every render — the
  // camera scanner holds `onResult` the same way, and for the same
  // reason: without it the listener would be torn down and rebuilt on
  // every keystroke it processed.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const isProtectedField = useCallback((node: Element | null): boolean => {
    if (node === null) return false;
    if (node.hasAttribute("data-wedge-capture")) return false;
    if (node instanceof HTMLInputElement) {
      // A checkbox or a button-shaped input takes no text, so there is
      // nothing to protect.
      return node.type !== "checkbox" && node.type !== "radio";
    }
    if (node instanceof HTMLTextAreaElement) return true;
    return node instanceof HTMLElement && node.isContentEditable;
  }, []);

  /**
   * Wipe a scan target that caught the burst's leading character.
   *
   * Nothing can be judged from one keystroke, so the first one is
   * always allowed through (and `]` opens a tier-1 burst without being
   * swallowed either). Harmless almost everywhere — but a
   * `data-wedge-capture` field is one an officer scans into
   * repeatedly, and a stray character left behind per scan does not
   * just look untidy: the gear-code combobox queries on its value, so
   * the leavings accumulate into `SSS` and a dropdown of nonsense.
   *
   * The value is set through the prototype's own setter before
   * dispatching `input`, which is what makes React's synthetic handler
   * observe the change — assigning `.value` on a controlled input
   * updates the DOM and leaves React's state stale, so the next render
   * puts the character straight back.
   *
   * Only runs on a burst that actually emitted, so an officer typing a
   * code by hand is never interrupted: slow keystrokes restart the
   * buffer and never reach this.
   */
  const clearScanTarget = useCallback((node: Element | null) => {
    if (node === null || !node.hasAttribute("data-wedge-capture")) return;
    if (
      !(node instanceof HTMLInputElement) &&
      !(node instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    if (node.value === "") return;
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(node) as object,
      "value",
    )?.set;
    setter?.call(node, "");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  useEffect(() => {
    if (!enabled) {
      stateRef.current = IDLE_WEDGE_STATE;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Shortcuts, not payload. A wedge sends plain keystrokes; Shift
      // for an uppercase character is the one modifier it does use, and
      // that arrives on the character event itself.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        stateRef.current = IDLE_WEDGE_STATE;
        return;
      }
      // Mid-composition keystrokes belong to the IME, not to us.
      if (event.isComposing) return;

      const isTerminator = event.key === "Enter" || event.key === "Tab";
      const state = stateRef.current;

      // Protect real typing: a tier-2 burst is only a *guess* that a
      // machine is typing, so it must not run inside a text field. A
      // tier-1 burst has announced itself and is allowed everywhere —
      // which is the entire payoff of configuring the gun.
      if (
        state.mode !== "tier1" &&
        !isWedgeOpener(event.key) &&
        isProtectedField(document.activeElement)
      ) {
        stateRef.current = IDLE_WEDGE_STATE;
        return;
      }

      const result = feedKey(state, {
        value: event.key,
        isTerminator,
        // `event.timeStamp`, not a `performance.now()` read in here:
        // same time basis, but it is the moment the key arrived rather
        // than the moment this handler got the thread. A janked main
        // thread would otherwise stretch a real scan's gaps past the
        // threshold and silently drop it.
        at: event.timeStamp,
      });
      stateRef.current = result.state;

      if (result.capture) {
        // Both halves matter. `preventDefault` stops a Tab terminator
        // moving focus and an Enter terminator clicking whatever button
        // holds it — the desk has a live "Check out N items" beside
        // this. `stopPropagation` keeps the burst away from cmdk and
        // Radix, which are listening on the same keys.
        event.preventDefault();
        event.stopPropagation();
      }
      if (result.emit !== null) {
        clearScanTarget(document.activeElement);
        onScanRef.current(result.emit);
      }
    };

    // Capture phase: `cmdk` and Radix handle Enter/Tab on their own
    // elements, and bubbling would reach them first.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      stateRef.current = IDLE_WEDGE_STATE;
    };
  }, [enabled, isProtectedField, clearScanTarget]);
}

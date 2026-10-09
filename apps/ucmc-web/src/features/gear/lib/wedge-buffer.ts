/**
 * Keyboard-wedge recognition, as a pure reducer (#215).
 *
 * A USB barcode scanner in HID keyboard-wedge mode — which is the mode
 * essentially all of them ship in — "types" the decoded payload and then
 * a terminator. The browser cannot tell it from a keyboard: there is no
 * device identity in a `keydown`, only keys and timestamps. So the
 * recognition is a heuristic, and this module is all of it.
 *
 * Calibrated against `onscan.js`, the closest prior art
 * (`avgTimeByChar: 30`, `timeBeforeScanTest: 100`, `suffixKeyCodes:
 * [9, 13]`). Its `minLength: 6` is the one default we cannot take:
 * UCMC codes are `CH93` and `LJ4`, so a six-character floor rejects
 * every label the cave owns. That, plus the library being untyped
 * vanilla JS against a `minimumReleaseAge`-quarantined supply chain, is
 * why this is ~100 lines here rather than a dependency.
 *
 * ## Two tiers
 *
 * **Tier 1 — the burst announces itself.** The reader is configured to
 * prepend something, so the very first keystroke identifies the burst
 * and there is no guessing. Two openers are accepted:
 *
 *   - `]`, the flag character of an **AIM symbology identifier**
 *     (ISO/IEC 15424), emitted when the gun's "Transmit Code ID
 *     Character" is set to AIM. This is the standard way to do it and
 *     the preferred config, because it also names the symbology.
 *   - {@link WEDGE_SENTINEL}, a plain configured preamble character —
 *     the fallback, because not every budget reader can emit an AIM ID
 *     at all while essentially any reader can prepend a character.
 *
 * Tier 1 matters because the caller may capture it **inside a focused
 * text field**: the burst is unambiguous, so there is nothing to
 * protect typing from.
 *
 * **Tier 2 — timing alone.** An unconfigured gun, the one somebody
 * plugs in next season after the first one dies, sends a bare burst.
 * Machine speed across every gap plus a terminator is the only signal
 * left. This tier is why the feature works out of the box; without it
 * a replacement gun fails *silently*, which in a volunteer-run cave is
 * the worst available outcome.
 *
 * ## What this module does NOT do
 *
 * It never strips an AIM identifier — `parseScanPayload` owns that, and
 * owns deciding what the string means. The one thing stripped here is
 * {@link WEDGE_SENTINEL}, which is this module's own invention and
 * means nothing downstream. Keeping the split that way is what stops
 * the two files disagreeing about whether `]99CH93` is a symbology
 * identifier (it isn't) or part of a code (it is).
 */

/**
 * Fallback opener for a reader that cannot emit an AIM symbology
 * identifier. **Swallowed on sight**, so a sentinel-mode burst leaks
 * nothing into a focused field — the stated cost is that `~` cannot be
 * typed anywhere the wedge listener is mounted while it is enabled.
 * Nobody types a tilde into a loan note, and the wedge toggle is the
 * escape hatch.
 *
 * A printable character, not a control code. STX/ETX framing is the
 * convention a scanner manual suggests first, and it is a trap in a
 * browser: those arrive as Ctrl+B / Ctrl+C, colliding with browser
 * shortcuts and with the listener's own rule that `ctrlKey` events are
 * shortcuts to be ignored.
 */
export const WEDGE_SENTINEL = "~";

/**
 * Flag character of an AIM symbology identifier (ISO/IEC 15424).
 *
 * Unlike the sentinel this is **not** swallowed on sight, and the
 * asymmetry is deliberate: `]` is a character someone might really
 * type into a note ("replaced buckle [2024]"), while `~` is not. So `]`
 * opens a tier-1 burst — which is what lets an AIM-configured gun work
 * inside a focused field — but the keystroke itself is allowed through
 * and buffered. Capture begins at the following key, once the gap has
 * proven machine speed. A human typing `]` therefore keeps it; the
 * worst case is one stray `]` in a field somebody was scanning into.
 */
const AIM_FLAG = "]";

export interface WedgeOptions {
  /**
   * Largest gap between consecutive keys that still reads as machine
   * speed. `onscan.js` uses 30 ms as an *average*; this is a per-gap
   * *maximum*, which is the stricter test at the same number, so 50
   * leaves room for a reader with a configured inter-character delay
   * without opening the door to a fast typist.
   *
   * The false-positive risk is small for a reason outside this module:
   * tier 2 does not run while a text field has focus, so there is
   * nowhere for a human to be typing fast enough to trip it.
   */
  maxInterKeyMs: number;
  /**
   * Shortest payload worth emitting. **3, not `onscan.js`'s 6** — `LJ4`
   * is a real code.
   */
  minLength: number;
  /**
   * Runaway guard. A cart token is 46 characters; this only has to be
   * clear of the longest real payload.
   */
  maxLength: number;
}

export const DEFAULT_WEDGE_OPTIONS: WedgeOptions = {
  maxInterKeyMs: 50,
  minLength: 3,
  maxLength: 128,
};

export interface WedgeState {
  /** Payload so far. Excludes {@link WEDGE_SENTINEL}; includes `]`. */
  chars: string;
  /** Timestamp of the last key accepted into this buffer. */
  lastAt: number;
  /**
   * `"tier1"` once an opener has identified the burst, `"timing"` for a
   * bare one. The caller reads this to decide whether a focused text
   * field should be protected — see the hook.
   */
  mode: "idle" | "tier1" | "timing";
  /** Overflowed {@link WedgeOptions.maxLength}; swallow but never emit. */
  disqualified: boolean;
  /**
   * Whether any character of this burst was captured. The page has an
   * incomplete picture of anything we swallowed, so the terminator
   * belongs to us too — even when the burst turns out to emit nothing.
   */
  swallowed: boolean;
}

export const IDLE_WEDGE_STATE: WedgeState = {
  chars: "",
  lastAt: 0,
  mode: "idle",
  disqualified: false,
  swallowed: false,
};

export interface WedgeKey {
  /** `KeyboardEvent.key`. Only single-character values are buffered. */
  value: string;
  /** Enter or Tab. Both are common out-of-the-box terminators. */
  isTerminator: boolean;
  /** `KeyboardEvent.timeStamp`. */
  at: number;
  /**
   * Buffer this key but let it reach the page.
   *
   * Set for a field that declared itself a scan target
   * (`data-wedge-capture`). Such a field is ALSO where an officer types
   * a code by hand, and tier 2 cannot tell the two apart until the
   * burst completes — so swallowing on suspicion costs a real
   * keystroke every time a human happens to hit two keys inside
   * `maxInterKeyMs`, which on a four-character code is ordinary fast
   * typing. Letting the characters land and clearing the field on a
   * completed scan is the trade that loses nothing either way.
   */
  passThrough?: boolean;
}

export interface WedgeResult {
  state: WedgeState;
  /** The completed payload, or `null` if this key completed nothing. */
  emit: string | null;
  /**
   * Whether the caller should `preventDefault()` this key. True only
   * once the burst is established, so an ordinary keystroke is never
   * swallowed — and **always** true for a terminator that emits, which
   * is load-bearing: the gear desk has a live submit button, and a
   * wedge's Enter would otherwise click whatever holds focus.
   */
  capture: boolean;
}

/** True when this key would open a tier-1 burst. */
export function isWedgeOpener(value: string): boolean {
  return value === WEDGE_SENTINEL || value === AIM_FLAG;
}

/**
 * Open a buffer on `key`. `swallowed` comes from the caller because
 * whether this first keystroke was captured is the same question as
 * whether it was the sentinel — deciding it twice is how the two
 * answers drift.
 */
function startBuffer(key: WedgeKey, swallowed: boolean): WedgeState {
  const isSentinel = key.value === WEDGE_SENTINEL;
  return {
    // The sentinel is ours and never part of the payload; `]` is the
    // page's character and stays in it.
    chars: isSentinel ? "" : key.value,
    lastAt: key.at,
    mode: isSentinel || key.value === AIM_FLAG ? "tier1" : "timing",
    disqualified: false,
    swallowed,
  };
}

/**
 * Feed one keystroke. Every input is a parameter, the clock included,
 * so the whole timing matrix is testable without fake timers — the same
 * shape as `lib/loan-reminders.ts`.
 */
export function feedKey(
  state: WedgeState,
  key: WedgeKey,
  opts: WedgeOptions = DEFAULT_WEDGE_OPTIONS,
): WedgeResult {
  if (key.isTerminator) {
    const complete =
      // Redundant while `minLength` is above zero — an idle buffer has
      // no characters — but `minLength` is an option, and a caller that
      // set it to 0 would otherwise have every stray Enter "complete" an
      // empty scan. Mutation testing reports this as a survivor for
      // exactly that reason; it is not dead code.
      state.mode !== "idle" &&
      !state.disqualified &&
      key.at - state.lastAt <= opts.maxInterKeyMs &&
      state.chars.length >= opts.minLength;
    return {
      state: IDLE_WEDGE_STATE,
      emit: complete ? state.chars : null,
      // Captured in two cases, and the first is the one that bites. A
      // burst whose characters we swallowed owns its terminator even
      // when it emits nothing — an over-long payload (a member's WiFi
      // QR read by a 2D imager) or one below `minLength` otherwise
      // swallows 200 characters and then hands the trailing Enter to
      // whatever holds focus, which at this desk is the live "Check out
      // N items" button. That is precisely the failure `preventDefault`
      // is here to prevent, arriving by the back door.
      //
      // The second is a completed scan in a pass-through field, where
      // nothing was swallowed but the payload is ours — so cmdk must
      // not also resolve the Enter by prefix match.
      //
      // Neither applies to a human pressing Enter on a focused button:
      // from idle there is nothing swallowed and nothing to complete.
      capture: state.swallowed || complete,
    };
  }

  // Dead keys, arrows, F-keys — anything whose `key` is a name rather
  // than a character. They are not payload, and they are not evidence
  // either way, so the buffer is left exactly as it was.
  if (key.value.length !== 1) {
    return { state, emit: null, capture: false };
  }

  const continues =
    state.mode !== "idle" && key.at - state.lastAt <= opts.maxInterKeyMs;

  if (!continues) {
    // A late key starts a NEW buffer rather than poisoning the current
    // one. Discarding instead would let a single stray keystroke eat
    // the scan that follows it.
    const capture = !key.passThrough && key.value === WEDGE_SENTINEL;
    return { state: startBuffer(key, capture), emit: null, capture };
  }

  if (state.disqualified || state.chars.length >= opts.maxLength) {
    // Keep swallowing to the end of the burst. Releasing mid-way would
    // spray the tail of an over-long payload into the page.
    return {
      state: {
        ...state,
        lastAt: key.at,
        disqualified: true,
        swallowed: state.swallowed || !key.passThrough,
      },
      emit: null,
      capture: !key.passThrough,
    };
  }

  return {
    state: {
      ...state,
      chars: state.chars + key.value,
      lastAt: key.at,
      swallowed: state.swallowed || !key.passThrough,
    },
    emit: null,
    // Machine speed is proven as of this key, so the burst is ours from
    // here even in tier 2 — unless the field asked to keep its
    // keystrokes, in which case we buffer silently and clear it on a
    // completed scan instead.
    capture: !key.passThrough,
  };
}

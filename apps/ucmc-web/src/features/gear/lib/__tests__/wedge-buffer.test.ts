import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEDGE_OPTIONS,
  IDLE_WEDGE_STATE,
  WEDGE_SENTINEL,
  feedKey,
  isWedgeOpener,
} from "#/features/gear/lib/wedge-buffer";
import type { WedgeResult, WedgeState } from "#/features/gear/lib/wedge-buffer";

/**
 * Drive a burst through the reducer. `gapMs` is the delay before EVERY
 * key including the first, which is what lets a case open a burst far
 * enough after the previous one to count as a fresh start.
 */
function burst(
  text: string,
  {
    gapMs = 10,
    terminator = "Enter",
    from = IDLE_WEDGE_STATE,
    startAt = 1000,
    passThrough = false,
  }: {
    gapMs?: number;
    terminator?: "Enter" | "Tab" | null;
    from?: WedgeState;
    startAt?: number;
    passThrough?: boolean;
  } = {},
): { results: WedgeResult[]; state: WedgeState; emitted: string | null } {
  let state = from;
  let at = startAt;
  const results: WedgeResult[] = [];
  for (const ch of text) {
    at += gapMs;
    const r = feedKey(
      state,
      { value: ch, isTerminator: false, at, passThrough },
      DEFAULT_WEDGE_OPTIONS,
    );
    results.push(r);
    state = r.state;
  }
  if (terminator !== null) {
    at += gapMs;
    const r = feedKey(
      state,
      { value: terminator, isTerminator: true, at, passThrough },
      DEFAULT_WEDGE_OPTIONS,
    );
    results.push(r);
    state = r.state;
  }
  // `findLast` needs lib es2023; a reverse scan says the same thing
  // against the project's target.
  const emitted =
    [...results].reverse().find((r: WedgeResult) => r.emit !== null)?.emit ??
    null;
  return { results, state, emitted };
}

describe("isWedgeOpener", () => {
  it("recognises both openers and nothing else", () => {
    expect(isWedgeOpener(WEDGE_SENTINEL)).toBe(true);
    expect(isWedgeOpener("]")).toBe(true);
    expect(isWedgeOpener("C")).toBe(false);
  });
});

describe("tier 2 — timing alone", () => {
  it("emits a machine-speed burst terminated by Enter", () => {
    expect(burst("CH93").emitted).toBe("CH93");
  });

  it("emits on a Tab terminator too", () => {
    // A Tab suffix is a common out-of-the-box config, and capture on it
    // is what stops the scan moving focus.
    const { emitted, results } = burst("CH93", { terminator: "Tab" });
    expect(emitted).toBe("CH93");
    expect(results.at(-1)?.capture).toBe(true);
  });

  it("does NOT emit a human-speed burst", () => {
    expect(burst("CH93", { gapMs: 150 }).emitted).toBeNull();
  });

  it("does not emit when only the last gap is slow", () => {
    // Every gap has to hold, not the average — a burst that stalls
    // before its terminator is a scan that was interrupted.
    let state = IDLE_WEDGE_STATE;
    let at = 1000;
    for (const ch of "CH93") {
      at += 10;
      state = feedKey(state, { value: ch, isTerminator: false, at }).state;
    }
    at += 400;
    expect(
      feedKey(state, { value: "Enter", isTerminator: true, at }).emit,
    ).toBeNull();
  });

  it("emits a three-character code", () => {
    // `LJ4` is real. onscan.js's minLength of 6 would reject it, which
    // is most of why this is hand-rolled.
    expect(burst("LJ4").emitted).toBe("LJ4");
  });

  it("refuses a two-character burst", () => {
    expect(burst("L4").emitted).toBeNull();
  });

  it("lets a stray keystroke be followed by a clean scan", () => {
    // The failure this guards: discarding on a late key instead of
    // restarting would let one stray keystroke eat the NEXT scan.
    const stray = feedKey(IDLE_WEDGE_STATE, {
      value: "x",
      isTerminator: false,
      at: 500,
    });
    expect(burst("CH93", { from: stray.state, startAt: 5000 }).emitted).toBe(
      "CH93",
    );
  });

  it("recovers after a burst that failed the speed test", () => {
    const slow = burst("CH93", { gapMs: 150 });
    expect(slow.emitted).toBeNull();
    expect(burst("LJ4", { from: slow.state, startAt: 9000 }).emitted).toBe(
      "LJ4",
    );
  });

  it("discards an over-long burst but keeps swallowing it", () => {
    const long = burst("X".repeat(200));
    expect(long.emitted).toBeNull();
    // Releasing mid-burst would spray the tail across the page.
    expect(long.results.at(-2)?.capture).toBe(true);
  });

  it("leaves the first keystroke to the page and captures from the second", () => {
    // Nothing can be judged from one key, so it must fall through. The
    // caller keeps tier 2 out of focused text fields for this reason.
    const { results } = burst("CH93");
    expect(results[0].capture).toBe(false);
    expect(results[1].capture).toBe(true);
  });
});

describe("tier 1 — a burst that announces itself", () => {
  it("swallows the sentinel and excludes it from the payload", () => {
    const { emitted, results } = burst(`${WEDGE_SENTINEL}CH93`);
    expect(emitted).toBe("CH93");
    // Captured on sight — this is the whole point of the sentinel, and
    // what lets the caller run it inside a focused text field.
    expect(results[0].capture).toBe(true);
  });

  it("opens on an AIM flag but lets that keystroke through", () => {
    // `]` is a character someone might really type ("[2024]"), so it is
    // buffered rather than swallowed. The asymmetry with `~` is
    // deliberate.
    const { emitted, results } = burst("]C0CH93");
    expect(emitted).toBe("]C0CH93");
    expect(results[0].capture).toBe(false);
    expect(results[1].capture).toBe(true);
  });

  it("hands the AIM identifier downstream rather than stripping it", () => {
    // Stripping is `parseScanPayload`'s job. Splitting it that way is
    // what stops the two files disagreeing about whether `]99…` is an
    // identifier or part of a code.
    expect(burst("]99CH93").emitted).toBe("]99CH93");
  });

  it("marks the burst tier-1 so the caller can override field protection", () => {
    const opened = feedKey(IDLE_WEDGE_STATE, {
      value: WEDGE_SENTINEL,
      isTerminator: false,
      at: 100,
    });
    expect(opened.state.mode).toBe("tier1");
    expect(
      feedKey(IDLE_WEDGE_STATE, { value: "C", isTerminator: false, at: 100 })
        .state.mode,
    ).toBe("timing");
  });

  it("still times out — the opener is not a licence to ignore the clock", () => {
    // A gun yanked mid-scan must not splice itself onto the next one.
    expect(burst(`${WEDGE_SENTINEL}CH93`, { gapMs: 200 }).emitted).toBeNull();
  });

  it("refuses a sentinel burst below the minimum length", () => {
    // The sentinel is not part of the payload, so `~L4` is two
    // characters, not three.
    expect(burst(`${WEDGE_SENTINEL}L4`).emitted).toBeNull();
  });
});

describe("terminators and non-character keys", () => {
  it("does not capture a terminator that completes nothing", () => {
    // Load-bearing: the desk has a live submit button, and swallowing
    // every Enter would make it unclickable by keyboard.
    const r = feedKey(IDLE_WEDGE_STATE, {
      value: "Enter",
      isTerminator: true,
      at: 100,
    });
    expect(r.capture).toBe(false);
    expect(r.emit).toBeNull();
  });

  it("captures a terminator that completes a scan", () => {
    // The other half of the same rule: a wedge's Enter must NOT reach
    // the focused submit button.
    expect(burst("CH93").results.at(-1)?.capture).toBe(true);
  });

  it("ignores a named key without disturbing the buffer", () => {
    let state = IDLE_WEDGE_STATE;
    for (const [i, ch] of [..."CH9"].entries()) {
      state = feedKey(state, {
        value: ch,
        isTerminator: false,
        at: 1000 + i * 10,
      }).state;
    }
    const shift = feedKey(state, {
      value: "Shift",
      isTerminator: false,
      at: 1035,
    });
    expect(shift.capture).toBe(false);
    expect(shift.state).toBe(state);
    expect(
      feedKey(shift.state, { value: "3", isTerminator: false, at: 1040 }).state
        .chars,
    ).toBe("CH93");
  });

  it("resets to idle after emitting", () => {
    // Asserted as a literal, not against `IDLE_WEDGE_STATE`: comparing
    // the constant to itself passes however the constant is mutated,
    // which is exactly what mutation testing surfaced here.
    expect(burst("CH93").state).toEqual({
      chars: "",
      lastAt: 0,
      mode: "idle",
      disqualified: false,
      swallowed: false,
    });
  });
});

describe("boundaries", () => {
  it("treats a gap of exactly maxInterKeyMs as machine speed", () => {
    expect(
      burst("CH93", { gapMs: DEFAULT_WEDGE_OPTIONS.maxInterKeyMs }).emitted,
    ).toBe("CH93");
  });

  it("treats one millisecond more as human speed", () => {
    expect(
      burst("CH93", { gapMs: DEFAULT_WEDGE_OPTIONS.maxInterKeyMs + 1 }).emitted,
    ).toBeNull();
  });

  it("emits a payload of exactly maxLength", () => {
    const exact = "X".repeat(DEFAULT_WEDGE_OPTIONS.maxLength);
    expect(burst(exact).emitted).toBe(exact);
  });

  it("disqualifies one character past maxLength", () => {
    expect(
      burst("X".repeat(DEFAULT_WEDGE_OPTIONS.maxLength + 1)).emitted,
    ).toBeNull();
  });

  it("emits a payload of exactly minLength", () => {
    expect(burst("X".repeat(DEFAULT_WEDGE_OPTIONS.minLength)).emitted).toBe(
      "XXX",
    );
  });

  it("opens a burst correctly when the page clock is still near zero", () => {
    // `lastAt` is 0 in the idle state, so "no buffer" and "a buffer
    // stamped at time zero" are only told apart by `mode`. Drop that
    // check and a scan arriving within `maxInterKeyMs` of the time
    // origin appends to the idle buffer, never leaves `"idle"`, and
    // silently never emits.
    expect(burst("CH93", { startAt: 0, gapMs: 5 }).emitted).toBe("CH93");
  });

  it("marks an AIM-flag burst tier-1", () => {
    // This is what lets an AIM-configured gun work inside a focused
    // text field; the sentinel case alone does not pin it.
    expect(
      feedKey(IDLE_WEDGE_STATE, { value: "]", isTerminator: false, at: 100 })
        .state.mode,
    ).toBe("tier1");
  });
});

describe("a swallowed burst owns its terminator", () => {
  it("captures the terminator of an over-long burst that emits nothing", () => {
    // The one that bites. A 2D imager pointed at a member's WiFi or URL
    // QR swallows 200 characters and then — before this — handed the
    // trailing Enter to whatever held focus, which at this desk is the
    // live "Check out N items" button. That is exactly the failure
    // `preventDefault` exists to prevent, arriving by the back door.
    const long = burst("X".repeat(DEFAULT_WEDGE_OPTIONS.maxLength + 50));
    expect(long.emitted).toBeNull();
    expect(long.results.at(-1)?.capture).toBe(true);
  });

  it("captures the Tab terminator of a too-short burst", () => {
    // Same rule, smaller blast radius: a two-character label would
    // otherwise move focus on its way out.
    const short = burst("L4", { terminator: "Tab" });
    expect(short.emitted).toBeNull();
    expect(short.results.at(-1)?.capture).toBe(true);
  });

  it("still releases a terminator when nothing was swallowed", () => {
    // Pressing Enter on a focused button has to keep working. From
    // idle there is nothing swallowed and nothing to complete.
    expect(
      feedKey(IDLE_WEDGE_STATE, { value: "Enter", isTerminator: true, at: 100 })
        .capture,
    ).toBe(false);
  });

  it("releases a terminator that arrives long after a lone keystroke", () => {
    // One stray key captures nothing, so the Enter behind it is the
    // page's.
    const stray = feedKey(IDLE_WEDGE_STATE, {
      value: "x",
      isTerminator: false,
      at: 1000,
    });
    expect(stray.capture).toBe(false);
    expect(
      feedKey(stray.state, { value: "Enter", isTerminator: true, at: 5000 })
        .capture,
    ).toBe(false);
  });
});

describe("pass-through fields keep their keystrokes", () => {
  it("never captures a character in a pass-through field", () => {
    // A declared scan target is also where an officer types a code by
    // hand, and tier 2 cannot tell the two apart until the burst
    // completes. Swallowing on suspicion costs a real keystroke every
    // time a human hits two keys inside `maxInterKeyMs` — ordinary
    // fast typing on a four-character code.
    const { results } = burst("CH93", { passThrough: true });
    expect(results.slice(0, -1).every((r) => !r.capture)).toBe(true);
  });

  it("still emits, and still captures the terminator, on a real burst", () => {
    // Nothing was swallowed, but the payload is ours — so cmdk must not
    // also resolve the Enter by prefix match.
    const { emitted, results } = burst("CH93", { passThrough: true });
    expect(emitted).toBe("CH93");
    expect(results.at(-1)?.capture).toBe(true);
  });

  it("leaves the terminator alone when the burst completes nothing", () => {
    // Typing a code by hand and pressing Enter: cmdk owns that.
    const { emitted, results } = burst("CH93", {
      passThrough: true,
      gapMs: 150,
    });
    expect(emitted).toBeNull();
    expect(results.at(-1)?.capture).toBe(false);
  });

  it("does not eat a fast digraph in the middle of hand-typing", () => {
    // `C` … 120 ms … `H` … 40 ms … `9`: the 40 ms gap reads as machine
    // speed, and before this the `9` was swallowed and never came back,
    // because no emit followed to clear the field.
    let state = IDLE_WEDGE_STATE;
    const captures: boolean[] = [];
    for (const [value, at] of [
      ["C", 1000],
      ["H", 1120],
      ["9", 1160],
      ["3", 1400],
    ] as const) {
      const r = feedKey(state, {
        value,
        isTerminator: false,
        at,
        passThrough: true,
      });
      captures.push(r.capture);
      state = r.state;
    }
    expect(captures).toEqual([false, false, false, false]);
  });
});

describe("a pass-through burst that completes nothing stays the page's", () => {
  it("releases the terminator of a too-short machine-speed burst", () => {
    // `L4` typed fast into the code box, then Enter. Nothing was
    // swallowed and nothing completed, so cmdk owns that Enter — it is
    // how an officer picks a highlighted suggestion by hand.
    const { emitted, results } = burst("L4", { passThrough: true });
    expect(emitted).toBeNull();
    expect(results.at(-1)?.capture).toBe(false);
  });

  it("releases the terminator of an over-long pass-through burst", () => {
    // Nothing was swallowed, so there is nothing for the terminator to
    // finish. The field keeps what landed in it and the officer can
    // see and clear it — better than silently eating the Enter too.
    const long = burst("X".repeat(DEFAULT_WEDGE_OPTIONS.maxLength + 50), {
      passThrough: true,
    });
    expect(long.emitted).toBeNull();
    expect(long.results.at(-1)?.capture).toBe(false);
  });
});

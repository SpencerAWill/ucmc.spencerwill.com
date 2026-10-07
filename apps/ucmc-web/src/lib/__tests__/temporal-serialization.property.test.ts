import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import { temporalSerializationAdapters } from "#/lib/temporal-serialization";

/**
 * Round-trip properties for the Temporal serialization adapters.
 *
 * These adapters sit on the server-fn / SSR boundary: every
 * `Temporal.Instant` a loader returns is stringified on the server and
 * revived on the client through exactly this pair of functions. A value
 * that doesn't round-trip doesn't fail loudly — it arrives as a
 * different moment, or a moment in a different zone, and renders a
 * plausible wrong answer.
 *
 * Round-tripping is the textbook property-test shape: the invariant is
 * `from(to(x)) === x` for *all* x, which is precisely what examples
 * can't establish and generators can.
 */

// Destructured positionally rather than looked up by key. `.find()`
// returns the union of the three adapter types, and calling
// `toSerializable` on that union makes its parameter the INTERSECTION
// `Instant & PlainDate & ZonedDateTime`, which TypeScript reduces to
// `never` — so every call fails to typecheck. The tuple is `as const`,
// so indexing it keeps each adapter's own type; the test below pins the
// order that makes this safe.
const [instantAdapter, plainDateAdapter, zonedDateTimeAdapter] =
  temporalSerializationAdapters;

it("registers the three adapters in the expected order", () => {
  // Guards the positional destructuring above: reordering the exported
  // tuple would otherwise silently point every test below at the wrong
  // adapter, and `toSerializable`/`fromSerializable` are symmetric
  // enough that some of them would still pass.
  expect(temporalSerializationAdapters.map((a) => a.key)).toEqual([
    "Temporal.Instant",
    "Temporal.PlainDate",
    "Temporal.ZonedDateTime",
  ]);
});

/**
 * Epoch milliseconds across a range that comfortably contains anything
 * the club will store — roughly 1970 to 2100 — rather than Temporal's
 * full ±273,000-year span, which would spend most of the run on years
 * no code path can produce.
 */
const epochMsArb = fc.integer({ min: 0, max: 4_102_444_800_000 });

describe("Temporal.Instant adapter", () => {
  const adapter = instantAdapter;

  it("round-trips any instant exactly", () => {
    fc.assert(
      fc.property(epochMsArb, (ms) => {
        const original = Temporal.Instant.fromEpochMilliseconds(ms);
        const revived = adapter.fromSerializable(
          adapter.toSerializable(original),
        );

        // Compared on epoch milliseconds, not `toString()`: two
        // instants that print differently cannot be equal, but the
        // reverse is what matters here and `equals` is the type's own
        // notion of identity.
        expect(revived.epochMilliseconds).toBe(original.epochMilliseconds);
        expect(revived.equals(original)).toBe(true);
      }),
    );
  });

  it("only claims instants", () => {
    // `test` is what routes a value to this adapter. If it widened, a
    // PlainDate would be serialized as an Instant and revived wrong.
    fc.assert(
      fc.property(epochMsArb, (ms) => {
        const instant = Temporal.Instant.fromEpochMilliseconds(ms);
        expect(adapter.test(instant)).toBe(true);
        expect(adapter.test(instant.toString())).toBe(false);
        expect(adapter.test(new Date(ms))).toBe(false);
      }),
    );
  });
});

describe("Temporal.PlainDate adapter", () => {
  const adapter = plainDateAdapter;

  it("round-trips any calendar date exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const original = Temporal.PlainDate.from({ year, month, day });
          const revived = adapter.fromSerializable(
            adapter.toSerializable(original),
          );

          expect(revived.equals(original)).toBe(true);
        },
      ),
    );
  });
});

describe("Temporal.ZonedDateTime adapter", () => {
  const adapter = zonedDateTimeAdapter;

  it("round-trips the zone, not just the instant", () => {
    // The reason `ZonedDateTime.toString()` includes `[America/New_York]`.
    // Dropping the bracketed zone still produces a parseable string and
    // the correct instant, so an instant-only assertion would pass while
    // every calendar read in `CLUB_TIME_ZONE` silently moved to UTC —
    // which is the exact bug CLAUDE.md's time-zone rule exists to stop.
    fc.assert(
      fc.property(
        epochMsArb,
        fc.constantFrom(CLUB_TIME_ZONE, "UTC", "Europe/London"),
        (ms, zone) => {
          const original =
            Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone);

          const revived = adapter.fromSerializable(
            adapter.toSerializable(original),
          );

          expect(revived.equals(original)).toBe(true);
          expect(revived.timeZoneId).toBe(zone);
          expect(revived.epochMilliseconds).toBe(original.epochMilliseconds);
        },
      ),
    );
  });

  it("survives both sides of a DST transition in the club zone", () => {
    // Fall-back repeats 01:00–02:00 locally. A round trip that resolved
    // the ambiguity by rule rather than by preserving the offset would
    // move one of these by an hour.
    const around = [
      "2026-11-01T05:00:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:00:00Z",
      "2026-11-01T06:30:00Z",
      "2026-03-08T06:59:00Z",
      "2026-03-08T07:00:00Z",
    ];

    for (const iso of around) {
      const original =
        Temporal.Instant.from(iso).toZonedDateTimeISO(CLUB_TIME_ZONE);
      const revived = adapter.fromSerializable(
        adapter.toSerializable(original),
      );

      expect(revived.epochMilliseconds, `round trip moved ${iso}`).toBe(
        original.epochMilliseconds,
      );
      expect(revived.hour, `local hour changed for ${iso}`).toBe(original.hour);
    }
  });
});

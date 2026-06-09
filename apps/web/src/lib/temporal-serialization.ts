/**
 * TanStack Start serialization adapters for TC39 Temporal types.
 *
 * The default serializer revives `Date` across the server-fn / SSR
 * boundary but knows nothing about Temporal. Without these adapters a
 * `Temporal.Instant` returned from a server fn or route loader would
 * arrive on the client as a bare ISO string (or break revival entirely).
 *
 * Each adapter is symmetric (client + server) via TanStack's Seroval
 * plugin, so a value round-trips transparently: `test` narrows by
 * `instanceof`, `toSerializable` emits the canonical ISO string (always
 * in `Serializable`), and `fromSerializable` reconstructs the instance.
 *
 * `ZonedDateTime.toString()` includes the IANA zone
 * (`…[America/New_York]`) so `from()` round-trips the zone losslessly.
 *
 * Registered on the Start instance in `src/start.ts`.
 */
import { createSerializationAdapter } from "@tanstack/react-router";

const instantAdapter = createSerializationAdapter({
  key: "Temporal.Instant",
  test: (v): v is Temporal.Instant => v instanceof Temporal.Instant,
  toSerializable: (v) => v.toString(),
  fromSerializable: (s: string) => Temporal.Instant.from(s),
});

const plainDateAdapter = createSerializationAdapter({
  key: "Temporal.PlainDate",
  test: (v): v is Temporal.PlainDate => v instanceof Temporal.PlainDate,
  toSerializable: (v) => v.toString(),
  fromSerializable: (s: string) => Temporal.PlainDate.from(s),
});

const zonedDateTimeAdapter = createSerializationAdapter({
  key: "Temporal.ZonedDateTime",
  test: (v): v is Temporal.ZonedDateTime => v instanceof Temporal.ZonedDateTime,
  toSerializable: (v) => v.toString(),
  fromSerializable: (s: string) => Temporal.ZonedDateTime.from(s),
});

export const temporalSerializationAdapters = [
  instantAdapter,
  plainDateAdapter,
  zonedDateTimeAdapter,
] as const;

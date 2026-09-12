/**
 * Glue for `<input type="datetime-local">`, whose value is a local
 * wall-clock string with no zone — one of the hard external boundaries
 * where `Temporal` meets a browser control.
 *
 * The officer entering an outing is doing so on a clock in the room, so
 * the input is read in the **runtime's** zone rather than the club's:
 * typing "9:00 AM" should mean 9am where the typist is. (Which band the
 * outing then lands in is a separate, club-zone question settled on the
 * server.)
 */

/** Epoch ms → `YYYY-MM-DDTHH:mm` in the viewer's zone. */
export function toLocalInputValue(epochMs: number): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(
    epochMs,
  ).toZonedDateTimeISO(Temporal.Now.timeZoneId());
  // `toPlainDateTime().toString()` yields seconds and fractions the
  // control rejects, so the value is assembled to the minute.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(
    zoned.hour,
  )}:${pad(zoned.minute)}`;
}

/**
 * `YYYY-MM-DDTHH:mm` in the viewer's zone → epoch ms. Returns `null` for
 * a blank or unparseable value, which is how the form distinguishes "not
 * filled in" from a real instant.
 */
export function fromLocalInputValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return Temporal.PlainDateTime.from(trimmed)
      .toZonedDateTime(Temporal.Now.timeZoneId())
      .toInstant().epochMilliseconds;
  } catch {
    return null;
  }
}

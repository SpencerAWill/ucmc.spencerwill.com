/**
 * Shared display formatting for phone numbers, the presentation-layer
 * counterpart to `#/lib/date-format`.
 *
 * Phone numbers are **stored in E.164** (`+15135551234`) — that's what
 * `PhoneField` writes into form state and what `phoneSchema` validates
 * on the way in, and it's the only form that's unambiguous, dialable
 * from anywhere, and comparable between rows. It is also unpleasant to
 * read, which is what this module fixes: E.164 stays the storage and
 * `tel:` form, and every *rendered* number goes through `formatPhone`.
 *
 * No new dependency — `react-phone-number-input` (a `libphonenumber-js`
 * wrapper) is already in the client graph for `PhoneField`, and its
 * bundled "min" metadata carries the national formatting patterns.
 */
import { parsePhoneNumber } from "react-phone-number-input";

/**
 * The country whose numbers render in national form. Shared with
 * `PhoneField`'s `country` default so the input and the display can't
 * disagree about which numbers are "local" — changing it in one place
 * without the other would format `+1` numbers on entry and then render
 * them with a country code, or vice versa.
 */
export const DEFAULT_PHONE_COUNTRY = "US" as const;

/**
 * Parse only if the result is a *valid* number, not merely a possible
 * one. Both exported helpers gate on this so they always agree about
 * which values get the formatted/linked treatment.
 *
 * The strictness matters at the edges: a truncated `+1513` parses with
 * no country and would otherwise render as the national fragment
 * "513", losing the digits it does have. `phoneSchema` has validated
 * every write for a while now, so in practice only historical rows can
 * fail here — and for those, showing the stored string verbatim beats
 * showing a lossy reformat of it.
 */
function parseValid(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = parsePhoneNumber(value.trim());
  return parsed?.isValid() ? parsed : undefined;
}

/**
 * Human-readable form — `(513) 555-1234` for `DEFAULT_PHONE_COUNTRY`,
 * international (`+44 20 7123 4567`) for everything else so a non-local
 * number never loses the country code you'd need to dial it.
 *
 * Anything that doesn't parse to a valid number falls back to the input
 * trimmed but otherwise untouched (and `""` for null/undefined), so a
 * malformed legacy row still shows the digits on file rather than
 * vanishing from the page.
 */
export function formatPhone(value: string | null | undefined): string {
  const parsed = parseValid(value);
  if (!parsed) {
    return value?.trim() ?? "";
  }
  return parsed.country === DEFAULT_PHONE_COUNTRY
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/**
 * `tel:` URI for a click-to-call link, or `undefined` when the value
 * isn't a valid number — callers render plain text in that case rather
 * than a link that hands the dialer a number it can't complete.
 *
 * The href is always E.164 regardless of how `formatPhone` renders the
 * same value; the two are deliberately decoupled (canonical for the
 * dialer, readable for the human).
 */
export function phoneHref(
  value: string | null | undefined,
): string | undefined {
  return parseValid(value)?.getURI();
}

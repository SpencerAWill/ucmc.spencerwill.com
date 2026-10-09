import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";

/**
 * The gear desk's scan-payload discriminator — the one place that
 * decides what a scanned string *is*.
 *
 * It used to be an inline `isCartToken(code)` branch at each call site:
 * `ucmc-cart:` prefix → resolve a cart, anything else → treat it as a
 * short code. That was fine while the camera scanner was the only
 * producer. It stopped being fine the moment a second producer existed
 * — see #224 finding 5 — because two call sites in two panes plus a
 * keyboard-wedge path is three copies of a decision that must agree.
 * #223 adds a third payload shape (`ucmc-model:` bin labels for counted
 * stock) and it belongs here as one branch, not as a fourth copy.
 *
 * Deliberately NOT a Zod schema: the `kind` is decided by prefix and the
 * code half has no shape to validate against (below).
 */

/**
 * An AIM symbology identifier (ISO/IEC 15424): `]`, a symbology
 * character, then a modifier digit. A reader prepends it to every scan
 * when "Transmit Code ID Character" is set to AIM (Zebra), "Send code
 * ID" (Datalogic) or "Symbology Prefix" (Honeywell). It is off by
 * default everywhere, so this is tolerance for a configured gun rather
 * than something we rely on.
 *
 * Our printed labels transmit **`]C0`** — plain CODE128. `]C1` is
 * GS1-128 (FNC1 in the first symbol position), which we never emit, so
 * this matches the *shape* rather than a literal: a hardcoded `]C1`
 * would have failed on every real scan. The modifier is `0`-`9` then
 * `A`-`F` as option values sum past nine.
 */
const AIM_SYMBOLOGY_ID = /^\](?<symbology>[A-Za-z][0-9A-F])/;

/**
 * Longest payload we will treat as a gear code. A cart token is 46
 * characters and is matched by prefix before this applies, so this only
 * bounds the bare-code branch — it is a runaway guard against a
 * mis-decoded or mis-keyed burst, not a statement about code length.
 */
const MAX_CODE_LENGTH = 64;

export type ScanPayload =
  | { kind: "cart"; token: string; symbology: string | null }
  | { kind: "code"; code: string; symbology: string | null };

/**
 * Classify a raw scan payload, from any source — the camera scanner, a
 * USB keyboard wedge, or a pasted string.
 *
 * Returns `null` for anything that cannot be either shape, which lets
 * the caller say "that didn't look like a gear label" instead of
 * round-tripping a lookup that was never going to match.
 *
 * `symbology` is the AIM symbology character when the reader
 * transmitted one (`"C0"` for our CODE128 labels, `"Q1"` for a QR cart
 * token, `"d1"` for a DataMatrix). It is a **hint, never a gate**: a
 * cart QR could be printed on paper and a gear code could be re-encoded
 * by anyone, so refusing a payload for arriving in an unexpected
 * symbology would reject real scans to enforce an assumption we never
 * made. Its one job is a better error message — a 2D imager pointed at
 * a harness reads the manufacturer's own DataMatrix (Petzl marks PPE
 * with one carrying the individual serial number), and "that's the
 * manufacturer's tag" beats "no gear matches code 3F8A91C2".
 */
export function parseScanPayload(raw: string): ScanPayload | null {
  // `\r` rides along with the Enter on some wedges; trim handles it
  // together with any stray surrounding space. Trimmed BEFORE the AIM
  // match because that pattern is `^`-anchored — a leading space would
  // otherwise hide the identifier and leave it in the code.
  const trimmed = raw.trim();
  const aim = AIM_SYMBOLOGY_ID.exec(trimmed);
  // `groups` is only `undefined` for a pattern with no named group, so
  // the chain here is the type system's requirement rather than a real
  // branch.
  const symbology = aim?.groups?.symbology ?? null;
  const value = aim ? trimmed.slice(aim[0].length) : trimmed;

  if (value.startsWith(CART_TOKEN_PREFIX)) {
    return { kind: "cart", token: value, symbology };
  }
  // Codes are freeform — `suggestCode` is advisory and an officer may
  // type anything — so there is no pattern to validate against without
  // rejecting real labels. These three rejections are only the things
  // that cannot be a code at all.
  if (value.length === 0 || value.length > MAX_CODE_LENGTH) return null;
  if (/\s/.test(value)) return null;
  return { kind: "code", code: value, symbology };
}

/**
 * Symbologies our label printer and cart QR can actually produce.
 * Anything else that still parsed as a code came off something we
 * didn't print — see `parseScanPayload`'s `symbology` note.
 */
const OWN_SYMBOLOGY_PREFIXES = ["C", "Q"];

/** True when the reader told us the symbology AND it isn't one we emit. */
export function isForeignSymbology(symbology: string | null): boolean {
  if (symbology === null) return false;
  return !OWN_SYMBOLOGY_PREFIXES.includes(symbology.charAt(0));
}

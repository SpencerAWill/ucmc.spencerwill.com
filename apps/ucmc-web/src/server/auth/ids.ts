import { customAlphabet } from "nanoid";

const generate = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

/**
 * Generate an opaque 12-character public identifier suitable for use in
 * URLs, audit trails, and other externally-visible references.
 *
 * Alphabet: lowercase alphanumerics. Length: 12. Collision-resistant
 * for the table sizes the app expects (tens of thousands of rows).
 */
export function generatePublicId(): string {
  return generate();
}
